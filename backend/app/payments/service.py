"""Payment orchestration: method availability, payment creation, idempotent confirmation,
webhooks, polling, refunds and expiry.

Duplicate-processing protection is layered:
1. Webhooks are stored in `webhooks` with UNIQUE(provider, event_id) → replays are ignored.
2. `confirm_paid` locks the payment row (SELECT … FOR UPDATE) and is a no-op if already paid.
3. The order row is locked as well; a second payment for an already-paid order is flagged, not re-fulfilled.
4. Blockchain tx hashes are UNIQUE per network, so one transfer can never pay two orders.
5. Fulfillment jobs are deduplicated by job id and are themselves idempotent.
"""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionLocal, on_commit
from app.core.errors import Conflict, NotFound, PaymentError, ValidationFailed
from app.core.events import publish_admin_event
from app.core.logging import get_logger
from app.core.queue import enqueue
from app.core.utils import i18n_get, money, utcnow
from app.models import (
    Admin,
    CryptoAddress,
    Order,
    Payment,
    PaymentMethod,
    Product,
    Refund,
    User,
    WebhookEvent,
)
from app.models.enums import (
    FINAL_PAYMENT_STATUSES,
    OPEN_ORDER_STATUSES,
    PAID_ORDER_STATUSES,
    BalanceTxType,
    OrderStatus,
    PaymentStatus,
)
from app.payments.base import PaymentContext, ProviderResult, ProviderUnavailable, RefundNotSupported
from app.payments.registry import PROVIDERS, build_provider
from app.services import promo as promo_service
from app.services import referrals as referral_service
from app.services.customers import add_event, adjust_balance, customer_line
from app.services.money import fmt
from app.services.notifications import notify
from app.services.orders import add_order_event, lock_order
from app.services.settings import settings_store

log = get_logger(__name__)
UNDERPAY_TOLERANCE = Decimal("0.005")  # 0.5% (exchange-rate rounding on invoices)


def new_reference() -> str:
    return "P" + secrets.token_hex(5).upper()


# ─── Methods ────────────────────────────────────────────────────────────────


async def available_methods(session: AsyncSession, order: Order, user: User) -> list[PaymentMethod]:
    methods = (
        await session.execute(
            select(PaymentMethod).where(PaymentMethod.enabled.is_(True)).order_by(PaymentMethod.sort_order, PaymentMethod.id)
        )
    ).scalars().all()
    out = []
    balance_on = await settings_store.feature("balance")
    for m in methods:
        if m.provider not in PROVIDERS:
            continue
        if m.min_amount is not None and order.total < m.min_amount:
            continue
        if m.max_amount is not None and m.max_amount > 0 and order.total > m.max_amount:
            continue
        if m.provider == "balance":
            if not balance_on or user.balance < order.total or order.total <= 0:
                continue
        else:
            provider = build_provider(m)
            if provider.missing_config():
                continue
        out.append(m)
    return out


def method_label(method: PaymentMethod, lang: str) -> str:
    name = i18n_get(method.name, lang)
    return f"{method.emoji} {name}".strip() if method.emoji else name


# ─── Creation ───────────────────────────────────────────────────────────────


async def start_payment(session: AsyncSession, order_id: int, method_code: str) -> Payment:
    order = await lock_order(session, order_id)
    if order is None:
        raise NotFound("Order not found")
    if order.status not in (OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT):
        raise Conflict("Order is not awaiting payment", code="order_not_payable")
    now = utcnow()
    if order.expires_at and order.expires_at <= now:
        raise Conflict("Order expired", code="payment.expired")
    method = (await session.execute(select(PaymentMethod).where(PaymentMethod.code == method_code))).scalar_one_or_none()
    if method is None or not method.enabled:
        raise ValidationFailed("Payment method unavailable", code="payment.provider_unavailable")
    user = await session.get(User, order.user_id)
    assert user is not None

    # Reuse an active payment for the same method (idempotent double-click)
    for p in order.payments:
        if p.method_code == method_code and p.status == PaymentStatus.PENDING and (not p.expires_at or p.expires_at > now):
            return p
    # Cancel other pending payments of this order
    for p in order.payments:
        if p.status == PaymentStatus.PENDING:
            p.status = PaymentStatus.CANCELLED
            await _release_address(session, p.id)

    fee = Decimal(str(method.fee_percent or 0))
    amount = money(order.total * (Decimal("1") + fee / Decimal("100")))
    timeout = int((method.public_config or {}).get("expiry_minutes") or 0)
    expires_at = min(order.expires_at or now + timedelta(minutes=30),
                     now + timedelta(minutes=timeout)) if timeout else (order.expires_at or now + timedelta(minutes=30))
    payment = Payment(
        id=uuid.uuid4(), reference=new_reference(), order_id=order.id, method_code=method.code,
        provider=method.provider, status=PaymentStatus.PENDING, amount=amount, currency=order.currency,
        expires_at=expires_at, extra={},
    )
    session.add(payment)
    await session.flush()

    provider = build_provider(method)
    items = ", ".join(f"{i.product_name} × {i.quantity}" for i in order.items)
    ctx = PaymentContext(payment=payment, order=order, user=user, method=method, public_config=provider.public,
                         secret_config=provider.secret, lang=user.language, expires_at=expires_at,
                         description=f"Order {order.number}: {items}")
    try:
        created = await provider.create_payment(ctx)
    except ProviderUnavailable as exc:
        payment.status = PaymentStatus.FAILED
        payment.error = str(exc)[:500]
        await add_order_event(session, order.id, "payment_failed", f"{method.code}: {exc}")
        await notify(session, "payment_failed", f"Payment method error · {order.number}", str(exc)[:300],
                     link=f"/orders/{order.id}", telegram_vars={"order": order.number, "reason": str(exc)[:300]},
                     dedupe_key=f"{method.code}", dedupe_ttl=900)
        raise PaymentError(str(exc), code="payment.provider_unavailable") from exc

    payment.external_id = created.external_id
    payment.pay_url = created.pay_url
    payment.pay_amount = created.pay_amount
    payment.pay_currency = created.pay_currency
    payment.network = created.network
    payment.address = created.address
    payment.memo = created.memo
    payment.expires_at = created.expires_at or expires_at
    payment.extra = {**(payment.extra or {}), **created.extra, "kind": created.kind}
    if pool_id := payment.extra.get("pool_address_id"):
        await session.execute(update(CryptoAddress).where(CryptoAddress.id == pool_id)
                              .values(assigned_payment_id=payment.id))
    order.status = OrderStatus.AWAITING_PAYMENT
    order.payment_method = method.code
    await add_order_event(
        session, order.id, "payment_created", f"Payment generated · {method_label(method, 'en')}",
        data={"payment_id": str(payment.id), "reference": payment.reference, "amount": str(payment.amount),
              "pay_amount": str(payment.pay_amount) if payment.pay_amount else None,
              "pay_currency": payment.pay_currency, "network": payment.network},
    )
    if created.kind == "instant" and method.provider == "balance":
        await adjust_balance(session, user.id, -amount, BalanceTxType.PURCHASE, order_id=order.id,
                             note=f"Order {order.number}")
        await confirm_paid(session, payment.id, source="balance")
    oid = order.id
    on_commit(session, lambda: publish_admin_event("order.updated", {"id": oid, "status": "awaiting_payment"}))
    return payment


async def assign_pool_address(payment: Payment, network: str, until: datetime) -> str | None:
    """Assign a free pool address to a payment (separate short transaction, row-locked)."""
    async with SessionLocal() as s:
        addr = (
            await s.execute(
                select(CryptoAddress)
                .where(CryptoAddress.network == network, CryptoAddress.enabled.is_(True),
                       or_(CryptoAddress.assigned_payment_id.is_(None), CryptoAddress.assigned_until < utcnow()))
                .order_by(CryptoAddress.assigned_until.nulls_first(), CryptoAddress.id)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
        ).scalar_one_or_none()
        if addr is None:
            return None
        addr.assigned_until = until + timedelta(minutes=15)
        await s.commit()
        address, addr_id = addr.address, addr.id
    payment.extra = {**(payment.extra or {}), "pool_address_id": addr_id}
    return address


async def _release_address(session: AsyncSession, payment_id: uuid.UUID) -> None:
    await session.execute(
        update(CryptoAddress).where(CryptoAddress.assigned_payment_id == payment_id)
        .values(assigned_payment_id=None, assigned_until=None)
    )


async def release_address_for_order(session: AsyncSession, order_id: int) -> None:
    ids = (await session.execute(select(Payment.id).where(Payment.order_id == order_id))).scalars().all()
    if ids:
        await session.execute(
            update(CryptoAddress).where(CryptoAddress.assigned_payment_id.in_(ids))
            .values(assigned_payment_id=None, assigned_until=None)
        )


# ─── Status application ─────────────────────────────────────────────────────


async def lock_payment(session: AsyncSession, payment_id: uuid.UUID) -> Payment | None:
    await session.flush()
    return (
        await session.execute(
            select(Payment).where(Payment.id == payment_id).with_for_update()
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def apply_result(session: AsyncSession, payment_id: uuid.UUID, result: ProviderResult, *, source: str) -> Payment:
    payment = await lock_payment(session, payment_id)
    if payment is None:
        raise NotFound("Payment not found")
    payment.last_checked_at = utcnow()
    if result.raw:
        payment.extra = {**(payment.extra or {}), **{k: v for k, v in result.raw.items() if v is not None}}
    if payment.status in FINAL_PAYMENT_STATUSES and result.status != PaymentStatus.PAID:
        return payment
    if result.status == PaymentStatus.PAID:
        await confirm_paid(session, payment.id, tx_hash=result.tx_hash, received_amount=result.received_amount,
                           confirmations=result.confirmations, external_id=result.external_id, source=source)
    elif result.status == PaymentStatus.AWAITING_CONFIRMATION:
        first_detection = payment.status != PaymentStatus.AWAITING_CONFIRMATION
        payment.status = PaymentStatus.AWAITING_CONFIRMATION
        if result.tx_hash and not payment.tx_hash:
            payment.tx_hash = result.tx_hash
        payment.confirmations = result.confirmations or 0
        payment.received_amount = result.received_amount
        order = await lock_order(session, payment.order_id)
        if order and order.status in OPEN_ORDER_STATUSES:
            order.status = OrderStatus.AWAITING_CONFIRMATION
            if first_detection:
                await add_order_event(session, order.id, "payment_detected", "Payment detected on-chain",
                                      data={"tx_hash": result.tx_hash, "confirmations": result.confirmations})
        pid = str(payment.id)
        on_commit(session, lambda: publish_admin_event("payment.updated", {"id": pid, "status": "awaiting_confirmation"}))
    elif result.status in (PaymentStatus.EXPIRED, PaymentStatus.CANCELLED, PaymentStatus.FAILED):
        payment.status = result.status
        payment.error = result.message
        await _release_address(session, payment.id)
    return payment


async def confirm_paid(
    session: AsyncSession,
    payment_id: uuid.UUID,
    *,
    source: str,
    tx_hash: str | None = None,
    received_amount: Decimal | None = None,
    confirmations: int | None = None,
    external_id: str | None = None,
    admin: Admin | None = None,
    note: str | None = None,
) -> bool:
    """Mark a payment as paid and the order as paid. Returns False if it was already processed."""
    payment = await lock_payment(session, payment_id)
    if payment is None:
        raise NotFound("Payment not found")
    if payment.status in (PaymentStatus.PAID, PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED):
        log.info("payment_already_processed", payment_id=str(payment_id), source=source)
        return False

    # Amount verification for amount-reporting providers (crypto direct reports exact amounts)
    if received_amount is not None and payment.pay_amount is not None and payment.provider == "crypto_direct":
        if Decimal(received_amount) < Decimal(payment.pay_amount) * (Decimal("1") - UNDERPAY_TOLERANCE):
            payment.status = PaymentStatus.AWAITING_CONFIRMATION
            payment.error = f"Underpaid: received {received_amount}, expected {payment.pay_amount}"
            await notify(session, "payment_failed", "Underpayment detected", payment.error,
                         link=f"/orders/{payment.order_id}", telegram_vars={"order": payment.reference, "reason": payment.error})
            return False

    now = utcnow()
    payment.status = PaymentStatus.PAID
    payment.paid_at = now
    if tx_hash:
        payment.tx_hash = tx_hash
    if confirmations is not None:
        payment.confirmations = confirmations
    if received_amount is not None:
        payment.received_amount = received_amount
    if external_id and not payment.external_id:
        payment.external_id = external_id
    await _release_address(session, payment.id)

    order = await lock_order(session, payment.order_id)
    assert order is not None
    user = await session.get(User, order.user_id)
    assert user is not None
    actor = "admin" if admin else "system"

    if order.status in PAID_ORDER_STATUSES or order.status in (OrderStatus.REFUNDED,):
        # Second payment for an already-paid order — keep the money safe, flag for refund.
        await add_order_event(session, order.id, "duplicate_payment",
                              f"Duplicate payment {payment.reference} received ({source})",
                              data={"payment_id": str(payment.id)})
        await notify(session, "payment_failed", f"Duplicate payment · {order.number}",
                     "A second payment was received for an already paid order. Consider refunding it.",
                     link=f"/orders/{order.id}",
                     telegram_vars={"order": order.number, "reason": "Duplicate payment received — review refund"})
        return True

    late = order.status in (OrderStatus.CANCELLED, OrderStatus.EXPIRED, OrderStatus.FAILED)
    if late and order.balance_used > 0:
        # Balance was returned on expiry — the customer only paid the remainder; charge the balance again if possible
        try:
            await adjust_balance(session, user.id, -order.balance_used, BalanceTxType.PURCHASE, order_id=order.id,
                                 note=f"Order {order.number} (late payment)")
        except ValidationFailed:
            order.total = money(order.total - order.balance_used)
            order.balance_used = Decimal("0")

    order.status = OrderStatus.PAID
    order.paid_at = now
    order.payment_method = payment.method_code
    order.cancelled_at = None
    for other in order.payments:
        if other.id != payment.id and other.status == PaymentStatus.PENDING:
            other.status = PaymentStatus.CANCELLED
    await add_order_event(
        session, order.id, "payment_confirmed",
        f"Payment confirmed via {payment.method_code}" + (" (late payment after expiry)" if late else ""),
        data={"payment_id": str(payment.id), "tx_hash": payment.tx_hash, "source": source, "note": note,
              "amount": str(payment.amount)},
        actor=actor, admin_id=admin.id if admin else None,
    )

    paid_value = money(order.total + order.balance_used)
    user.total_spent = money(user.total_spent + paid_value)
    user.paid_orders_count += 1
    if user.first_order_at is None:
        user.first_order_at = now
    await add_event(session, user.id, "payment_received", f"Paid order {order.number} · {paid_value}",
                    {"order_id": order.id, "payment_id": str(payment.id)})
    for item in order.items:
        if item.product_id:
            await session.execute(
                update(Product).where(Product.id == item.product_id).values(sold_count=Product.sold_count + item.quantity)
            )
    await promo_service.record_usage(session, order)
    await referral_service.reward_for_order(session, order)

    threshold = Decimal(str(await settings_store.get("checkout.large_payment_threshold", 0) or 0))
    ntype = "large_payment" if threshold and paid_value >= threshold else "payment_received"
    total_text = await fmt(paid_value, order.currency)
    await notify(session, ntype, f"Payment received · {order.number}", f"{user.display_name} · {total_text}",
                 link=f"/orders/{order.id}",
                 telegram_vars={"order": order.number, "customer": customer_line(user), "total": total_text,
                                "method": payment.method_code},
                 data={"order_id": order.id})

    order_id, pid = order.id, str(payment.id)

    async def _after() -> None:
        await publish_admin_event("payment.updated", {"id": pid, "status": "paid", "order_id": order_id})
        await publish_admin_event("order.updated", {"id": order_id, "status": "paid"})
        queued = await enqueue("fulfill_order", order_id, _job_id=f"fulfill:{order_id}:{pid}")
        if not queued:
            # Queue unavailable → fulfil inline so the customer still gets the goods.
            from app.fulfillment.service import fulfill_order

            await fulfill_order(order_id)
        from app.services.webhooks_out import dispatch

        await dispatch("order.paid", {"order_id": order_id, "payment_id": pid})

    on_commit(session, _after)
    return True


async def refresh_payment(session: AsyncSession, payment_id: uuid.UUID) -> Payment:
    """Poll the provider for a payment and apply the result."""
    payment = await session.get(Payment, payment_id)
    if payment is None:
        raise NotFound("Payment not found")
    if payment.status in FINAL_PAYMENT_STATUSES:
        return payment
    method = (await session.execute(select(PaymentMethod).where(PaymentMethod.code == payment.method_code))).scalar_one_or_none()
    if method is None:
        return payment
    provider = build_provider(method)
    if not provider.supports_polling:
        return payment
    result = await provider.check_payment(payment)
    if result is None:
        payment.last_checked_at = utcnow()
        return payment
    return await apply_result(session, payment.id, result, source="poll")


# ─── Webhooks ───────────────────────────────────────────────────────────────


async def handle_webhook(session: AsyncSession, provider_code: str, headers: dict[str, str], body: bytes) -> dict[str, Any]:
    cls = PROVIDERS.get(provider_code)
    if cls is None or not cls.supports_webhook:
        raise NotFound("Unknown provider")
    methods = (await session.execute(select(PaymentMethod).where(PaymentMethod.provider == provider_code))).scalars().all()
    configs = []
    for m in methods:
        p = build_provider(m)
        configs.append((m, p.public, p.secret))
    parsed = await cls.handle_webhook(headers, body, configs)
    # Idempotency: insert event row; if it already exists this is a replay.
    stmt = (
        insert(WebhookEvent)
        .values(provider=provider_code, event_id=parsed.event_id[:128], event_type=parsed.event_type[:64],
                signature_valid=parsed.signature_valid, payload=parsed.payload, status="received")
        .on_conflict_do_nothing(index_elements=["provider", "event_id"])
        .returning(WebhookEvent.id)
    )
    event_id = (await session.execute(stmt)).scalar_one_or_none()
    if not parsed.signature_valid:
        log.warning("webhook_invalid_signature", provider=provider_code)
        if event_id:
            await session.execute(update(WebhookEvent).where(WebhookEvent.id == event_id)
                                  .values(status="failed", error="invalid signature"))
        await notify(session, "suspicious", "Invalid payment webhook signature",
                     f"Provider {provider_code}: a webhook with an invalid signature was rejected.",
                     link="/audit-logs", telegram_vars={"details": f"Invalid webhook signature ({provider_code})"},
                     dedupe_key=provider_code, dedupe_ttl=600)
        raise PaymentError("Invalid signature", code="invalid_signature")
    if event_id is None:
        log.info("webhook_duplicate", provider=provider_code, event_id=parsed.event_id)
        return {"ok": True, "duplicate": True}
    status, error = "ignored", None
    if parsed.result is not None:
        q = select(Payment).where(Payment.provider == provider_code)
        if parsed.result.external_id:
            q = q.where(Payment.external_id == parsed.result.external_id)
        elif parsed.result.reference:
            q = q.where(Payment.reference == parsed.result.reference)
        else:
            q = q.where(Payment.id.is_(None))
        payment = (await session.execute(q)).scalar_one_or_none()
        if payment is None and parsed.result.reference:
            payment = (await session.execute(select(Payment).where(Payment.reference == parsed.result.reference))).scalar_one_or_none()
        if payment is None:
            status, error = "failed", "payment not found"
        else:
            await apply_result(session, payment.id, parsed.result, source="webhook")
            status = "processed"
    await session.execute(update(WebhookEvent).where(WebhookEvent.id == event_id)
                          .values(status=status, error=error, processed_at=utcnow()))
    return parsed.response


# ─── Telegram native payments ───────────────────────────────────────────────


async def validate_telegram_invoice(session: AsyncSession, reference: str, currency: str, total_amount: int) -> str | None:
    """Pre-checkout validation. Returns an error message or None if OK."""
    payment = (await session.execute(select(Payment).where(Payment.reference == reference))).scalar_one_or_none()
    if payment is None:
        return "Payment not found"
    if payment.status != PaymentStatus.PENDING:
        return "This invoice is no longer valid"
    if payment.expires_at and payment.expires_at < utcnow():
        return "This invoice has expired"
    order = await session.get(Order, payment.order_id)
    if order is None or order.status not in OPEN_ORDER_STATUSES:
        return "Order is no longer awaiting payment"
    expected = int(payment.extra.get("stars") or payment.extra.get("minor_units") or 0)
    if expected != total_amount or (payment.pay_currency or "").upper() != currency.upper():
        return "Amount mismatch"
    return None


async def telegram_payment_succeeded(session: AsyncSession, reference: str, charge_id: str, provider_charge_id: str | None,
                                     total_amount: int) -> bool:
    payment = (await session.execute(select(Payment).where(Payment.reference == reference))).scalar_one_or_none()
    if payment is None:
        log.error("telegram_payment_unknown_reference", reference=reference)
        return False
    payment.extra = {**(payment.extra or {}), "telegram_charge_id": charge_id, "provider_charge_id": provider_charge_id}
    return await confirm_paid(session, payment.id, source="telegram", external_id=charge_id,
                              received_amount=Decimal(total_amount))


async def customer_reports_paid(session: AsyncSession, order_id: int) -> Order:
    """'I have paid' for manual methods → awaiting admin confirmation."""
    order = await lock_order(session, order_id)
    if order is None:
        raise NotFound("Order not found")
    payment = next((p for p in reversed(order.payments) if p.status == PaymentStatus.PENDING), None)
    if payment is None or payment.provider != "manual":
        return order
    payment.status = PaymentStatus.AWAITING_CONFIRMATION
    order.status = OrderStatus.AWAITING_CONFIRMATION
    order.expires_at = utcnow() + timedelta(days=3)
    await add_order_event(session, order.id, "payment_reported", "Customer reported the payment as sent",
                          actor="customer")
    user = await session.get(User, order.user_id)
    await notify(session, "payment_received", f"Payment to verify · {order.number}",
                 f"{user.display_name if user else ''} reported a manual payment of {await fmt(order.total, order.currency)}",
                 link=f"/orders/{order.id}",
                 telegram_vars={"order": order.number, "customer": customer_line(user) if user else "",
                                "total": await fmt(order.total, order.currency), "method": "manual (verify!)"})
    oid = order.id
    on_commit(session, lambda: publish_admin_event("order.updated", {"id": oid, "status": "awaiting_confirmation"}))
    return order


# ─── Admin actions ──────────────────────────────────────────────────────────


async def admin_mark_paid(session: AsyncSession, order_id: int, admin: Admin, note: str | None) -> Order:
    order = await lock_order(session, order_id)
    if order is None:
        raise NotFound("Order not found")
    if order.status in PAID_ORDER_STATUSES or order.status in (OrderStatus.REFUNDED,):
        raise Conflict("Order is already paid")
    payment = next(
        (p for p in reversed(order.payments)
         if p.status in (PaymentStatus.PENDING, PaymentStatus.AWAITING_CONFIRMATION)), None,
    )
    if payment is None:
        if order.status in (OrderStatus.CANCELLED, OrderStatus.EXPIRED):
            # Re-reserve nothing here: fulfillment will reserve available stock or fall back to manual delivery.
            pass
        payment = Payment(id=uuid.uuid4(), reference=new_reference(), order_id=order.id, method_code="manual",
                          provider="manual", status=PaymentStatus.PENDING, amount=order.total, currency=order.currency,
                          extra={"kind": "manual", "created_by_admin": admin.id})
        session.add(payment)
        await session.flush()
    await confirm_paid(session, payment.id, source="admin", admin=admin, note=note)
    return order


async def refund_order(
    session: AsyncSession, order_id: int, *, amount: Decimal, method: str, reason: str | None, admin: Admin,
) -> Refund:
    """Refund (full or partial) to the original provider, to store balance, or record a manual refund."""
    order = await lock_order(session, order_id)
    if order is None:
        raise NotFound("Order not found")
    if order.status not in (*PAID_ORDER_STATUSES, OrderStatus.REFUNDED):
        raise Conflict("Only paid orders can be refunded")
    paid_value = money(order.total + order.balance_used)
    refundable = money(paid_value - order.refunded_amount)
    amount = money(amount)
    if amount <= 0 or amount > refundable:
        raise ValidationFailed(f"Refund amount must be between 0 and {refundable}")
    payment = next((p for p in reversed(order.payments) if p.status in (PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED)), None)
    user = await session.get(User, order.user_id)
    assert user is not None
    external_id = None
    if method == "provider":
        if payment is None:
            raise ValidationFailed("No paid payment to refund")
        pm = (await session.execute(select(PaymentMethod).where(PaymentMethod.code == payment.method_code))).scalar_one_or_none()
        if pm is None:
            raise ValidationFailed("Payment method no longer exists")
        provider = build_provider(pm)
        try:
            res = await provider.refund_payment(payment, amount, user)
        except RefundNotSupported as exc:
            raise ValidationFailed(str(exc)) from exc
        except ProviderUnavailable as exc:
            raise PaymentError(str(exc)) from exc
        if not res.ok:
            raise PaymentError(res.message or "Refund failed")
        external_id = res.external_id
    elif method == "balance":
        await adjust_balance(session, user.id, amount, BalanceTxType.REFUND, order_id=order.id, admin_id=admin.id,
                             note=f"Refund for order {order.number}")
    elif method != "manual":
        raise ValidationFailed("Unknown refund method")

    refund = Refund(order_id=order.id, payment_id=payment.id if payment else None, amount=amount, method=method,
                    reason=reason, external_id=external_id, admin_id=admin.id)
    session.add(refund)
    order.refunded_amount = money(order.refunded_amount + amount)
    full = order.refunded_amount >= paid_value
    order.status = OrderStatus.REFUNDED if full else OrderStatus.PARTIALLY_REFUNDED
    if payment:
        payment.refunded_amount = money(payment.refunded_amount + min(amount, payment.amount))
        payment.status = PaymentStatus.REFUNDED if full else PaymentStatus.PARTIALLY_REFUNDED
    user.total_spent = money(max(Decimal("0"), user.total_spent - amount))
    await add_order_event(session, order.id, "refunded", f"Refund {amount} via {method}" + (f": {reason}" if reason else ""),
                          actor="admin", admin_id=admin.id, data={"amount": str(amount), "method": method})
    await add_event(session, user.id, "refund", f"Refund {amount} for order {order.number}", {"order_id": order.id},
                    admin_id=admin.id)
    amount_text = await fmt(amount, order.currency)
    await notify(session, "refund", f"Refund · {order.number}", f"{amount_text} by {admin.name}",
                 link=f"/orders/{order.id}",
                 telegram_vars={"order": order.number, "amount": amount_text, "admin": admin.name})
    tg_id, lang, number = user.telegram_id, user.language, order.number

    async def _tell_customer() -> None:
        from app.bot.notify import send_text
        from app.services.texts import t

        to_balance = await t("order.refunded_to_balance", lang) if method == "balance" else ""
        await send_text(tg_id, await t("order.refunded", lang, order=number, amount=amount_text, to_balance=to_balance))

    on_commit(session, _tell_customer)
    oid = order.id
    on_commit(session, lambda: publish_admin_event("order.updated", {"id": oid, "status": order.status.value}))
    return refund


# ─── Expiry ─────────────────────────────────────────────────────────────────


async def expire_overdue(session: AsyncSession, limit: int = 100) -> list[int]:
    """Expire unpaid orders past their deadline (after a last provider check)."""
    from app.services.orders import cancel_order

    now = utcnow()
    candidates = (
        await session.execute(
            select(Order.id).where(Order.status.in_([OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT]),
                                   Order.expires_at < now)
            .order_by(Order.expires_at).limit(limit)
        )
    ).scalars().all()
    expired: list[int] = []
    for oid in candidates:
        order = await lock_order(session, oid)
        if order is None or order.status not in (OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT):
            continue
        # Last-chance check so a payment made at the last second is not lost
        for p in list(order.payments):
            if p.status == PaymentStatus.PENDING:
                try:
                    await refresh_payment(session, p.id)
                except Exception as exc:
                    log.warning("final_payment_check_failed", payment_id=str(p.id), error=str(exc))
        await session.refresh(order)
        if order.status not in (OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT):
            continue
        await cancel_order(session, order, reason="Payment window expired", expired=True)
        expired.append(order.id)
    return expired
