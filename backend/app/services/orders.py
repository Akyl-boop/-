"""Order creation, cancellation/expiry and timeline."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import on_commit
from app.core.errors import Conflict, OutOfStock, PromoError, ValidationFailed
from app.core.events import publish_admin_event
from app.core.utils import i18n_get, money, utcnow
from app.models import Order, OrderEvent, OrderItem, Payment, Product, ProductVariant, PromoCode, User
from app.models.enums import (
    OPEN_ORDER_STATUSES,
    PAID_ORDER_STATUSES,
    BalanceTxType,
    DeliveryMode,
    OrderStatus,
    PaymentStatus,
    ProductStatus,
    StockMode,
)
from app.services import inventory as inv
from app.services.customers import add_event, adjust_balance, customer_line
from app.services.money import fmt
from app.services.notifications import notify
from app.services.promo import PricedLine, validate_promo
from app.services.settings import settings_store


@dataclass
class LineRequest:
    variant_id: int
    quantity: int


async def add_order_event(
    session: AsyncSession, order_id: int, type_: str, message: str, *, data: dict[str, Any] | None = None,
    actor: str = "system", admin_id: int | None = None,
) -> None:
    session.add(OrderEvent(order_id=order_id, type=type_, message=message[:500], data=data, actor=actor,
                           admin_id=admin_id))


async def next_order_number(session: AsyncSession) -> str:
    seq = (await session.execute(text("SELECT nextval('order_number_seq')"))).scalar_one()
    prefix = (await settings_store.get("general.order_prefix", "NX")) or "NX"
    return f"{prefix}-{int(seq)}"


def effective_delivery_mode(product: Product, variant: ProductVariant) -> DeliveryMode:
    return variant.delivery_mode or product.delivery_mode


async def purchased_quantity(session: AsyncSession, user_id: int, product_id: int) -> int:
    q = (
        select(func.coalesce(func.sum(OrderItem.quantity), 0))
        .join(Order, Order.id == OrderItem.order_id)
        .where(Order.user_id == user_id, OrderItem.product_id == product_id,
               Order.status.in_([*PAID_ORDER_STATUSES, *OPEN_ORDER_STATUSES]))
    )
    return int((await session.execute(q)).scalar_one())


async def create_order(
    session: AsyncSession,
    user: User,
    lines: list[LineRequest],
    *,
    promo_code_id: int | None = None,
    use_balance: bool = False,
    source: str = "bot",
) -> Order:
    """Create an order, reserving inventory atomically. Caller commits."""
    if not lines:
        raise ValidationFailed("Cart is empty", code="cart.empty")
    if user.is_banned:
        raise ValidationFailed("Banned", code="error.banned")

    checkout = await settings_store.group("checkout")
    open_orders = (
        await session.execute(
            select(func.count()).select_from(Order)
            .where(Order.user_id == user.id, Order.status.in_(OPEN_ORDER_STATUSES))
        )
    ).scalar_one()
    if open_orders >= int(checkout.get("max_open_orders_per_user") or 3):
        # Cancel the oldest unpaid order instead of blocking the customer.
        oldest = (
            await session.execute(
                select(Order).where(Order.user_id == user.id, Order.status.in_(OPEN_ORDER_STATUSES))
                .order_by(Order.created_at).limit(1).with_for_update(of=Order)
            )
        ).scalar_one_or_none()
        if oldest is not None:
            await cancel_order(session, oldest, reason="Superseded by a new order", actor="system")

    variant_ids = [ln.variant_id for ln in lines]
    variants = {
        v.id: v
        for v in (
            await session.execute(
                select(ProductVariant).where(ProductVariant.id.in_(variant_ids))
                .options(selectinload(ProductVariant.product).selectinload(Product.variants))
            )
        ).scalars()
    }
    general = await settings_store.group("general")
    currency = general["currency"]
    lang = user.language

    priced: list[tuple[LineRequest, ProductVariant, Product]] = []
    for ln in lines:
        v = variants.get(ln.variant_id)
        if v is None or not v.is_active:
            raise ValidationFailed("Unavailable", code="error.not_found")
        p = v.product
        if p.deleted_at is not None or p.status not in (ProductStatus.ACTIVE, ProductStatus.OUT_OF_STOCK):
            raise ValidationFailed("Unavailable", code="error.not_found")
        if ln.quantity < p.min_quantity or (p.max_quantity and ln.quantity > p.max_quantity):
            raise ValidationFailed("Quantity out of range", code="product.limit_reached")
        if p.max_per_customer:
            already = await purchased_quantity(session, user.id, p.id)
            if already + ln.quantity > p.max_per_customer:
                raise ValidationFailed("Per-customer limit", code="product.limit_reached")
        priced.append((ln, v, p))

    subtotal = money(sum((v.price * ln.quantity for ln, v, _ in priced), Decimal("0")))
    if checkout.get("min_order_amount") and subtotal < Decimal(str(checkout["min_order_amount"])):
        raise ValidationFailed("Below minimum", code="checkout.min_amount",
                               details={"amount": await fmt(checkout["min_order_amount"])})
    if checkout.get("max_order_amount") and subtotal > Decimal(str(checkout["max_order_amount"])):
        raise ValidationFailed("Above maximum", code="checkout.max_amount",
                               details={"amount": await fmt(checkout["max_order_amount"])})

    discount = Decimal("0")
    promo: PromoCode | None = None
    if promo_code_id and await settings_store.feature("promo_codes"):
        promo = await session.get(PromoCode, promo_code_id)
        try:
            res = await validate_promo(
                session, promo, user,
                [PricedLine(p.id, p.category_id, money(v.price * ln.quantity)) for ln, v, p in priced],
            )
            discount = res.discount
        except PromoError:
            promo = None

    order = Order(
        number=await next_order_number(session),
        user_id=user.id,
        status=OrderStatus.PENDING,
        currency=currency,
        subtotal=subtotal,
        discount_total=discount,
        total=money(subtotal - discount),
        promo_code_id=promo.id if promo else None,
        promo_code=promo.code if promo else None,
        language=lang,
        source=source,
        expires_at=utcnow() + timedelta(minutes=int(checkout.get("payment_timeout_minutes") or 30)),
    )
    session.add(order)
    await session.flush()

    # Distribute discount proportionally across items (for accurate per-product revenue)
    remaining_discount = discount
    cost_total = Decimal("0")
    has_cost = True
    for idx, (ln, v, p) in enumerate(priced):
        line_total = money(v.price * ln.quantity)
        if idx == len(priced) - 1:
            line_discount = remaining_discount
        else:
            line_discount = money(discount * line_total / subtotal) if subtotal > 0 else Decimal("0")
            remaining_discount -= line_discount
        if v.cost_price is None:
            has_cost = False
        else:
            cost_total += v.cost_price * ln.quantity
        item = OrderItem(
            order_id=order.id, product_id=p.id, variant_id=v.id, category_id=p.category_id,
            product_name=i18n_get(p.name, lang), variant_name=_variant_label(p, v, lang), sku=v.sku,
            unit_price=v.price, unit_cost=v.cost_price, quantity=ln.quantity, discount=line_discount,
            total=money(line_total - line_discount), delivery_mode=effective_delivery_mode(p, v),
        )
        session.add(item)
        await session.flush()
        # Reserve stock
        if p.stock_mode == StockMode.INVENTORY:
            try:
                await inv.reserve(session, v.id, ln.quantity, order.id, item.id)
            except OutOfStock as exc:
                raise OutOfStock("Not enough stock", code="checkout.out_of_stock",
                                 details={"name": item.product_name}) from exc
        elif p.stock_mode == StockMode.MANUAL:
            res = await session.execute(
                update(ProductVariant)
                .where(ProductVariant.id == v.id, ProductVariant.manual_stock >= ln.quantity)
                .values(manual_stock=ProductVariant.manual_stock - ln.quantity)
                .returning(ProductVariant.id)
            )
            if res.scalar_one_or_none() is None:
                raise OutOfStock("Not enough stock", code="checkout.out_of_stock", details={"name": item.product_name})
    order.cost_total = money(cost_total) if has_cost else None

    # Internal balance
    if use_balance and await settings_store.feature("balance") and user.balance > 0 and order.total > 0:
        use = money(min(user.balance, order.total))
        await adjust_balance(session, user.id, -use, BalanceTxType.PURCHASE, order_id=order.id,
                             note=f"Order {order.number}")
        order.balance_used = use
        order.total = money(order.total - use)

    user.orders_count += 1
    await add_order_event(session, order.id, "created", "Order created",
                          data={"items": len(priced), "subtotal": str(subtotal), "discount": str(discount)},
                          actor="customer" if source == "bot" else "admin")
    await add_event(session, user.id, "order_created", f"Order {order.number} created",
                    {"order_id": order.id, "total": str(order.total)})
    await inv.refresh_out_of_stock_status(session, list({p.id for _, _, p in priced}))

    items_text = "\n".join(f"• {i18n_get(p.name, 'en')} × {ln.quantity}" for ln, v, p in priced)
    await notify(session, "new_order", f"New order {order.number}",
                 f"{user.display_name} · {await fmt(order.total + order.balance_used, currency)}",
                 link=f"/orders/{order.id}",
                 telegram_vars={"order": order.number, "customer": customer_line(user), "items": items_text,
                                "total": await fmt(order.total + order.balance_used, currency)},
                 data={"order_id": order.id})
    order_id, number = order.id, order.number
    on_commit(session, lambda: publish_admin_event("order.created", {"id": order_id, "number": number}))
    on_commit(session, lambda: _check_stock_after(order_id))
    return order


async def _check_stock_after(order_id: int) -> None:
    from app.core.queue import enqueue

    await enqueue("check_low_stock_for_order", order_id)


def _variant_label(product: Product, variant: ProductVariant, lang: str) -> str | None:
    if len([v for v in product.variants if v.is_active]) <= 1 and variant.is_default:
        return None
    return i18n_get(variant.name, lang) or None


async def lock_order(session: AsyncSession, order_id: int) -> Order | None:
    # populate_existing refreshes already-loaded objects → flush pending changes first so they are not lost
    await session.flush()
    return (
        await session.execute(
            select(Order).where(Order.id == order_id).with_for_update(of=Order).execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()


async def _release_resources(session: AsyncSession, order: Order) -> None:
    await inv.release_for_order(session, order.id)
    # Restore manual stock counters
    for item in order.items:
        if item.variant_id is None:
            continue
        v = await session.get(ProductVariant, item.variant_id)
        if v is not None:
            product = await session.get(Product, v.product_id)
            if product is not None and product.stock_mode == StockMode.MANUAL:
                await session.execute(
                    update(ProductVariant).where(ProductVariant.id == v.id)
                    .values(manual_stock=ProductVariant.manual_stock + item.quantity)
                )
    if order.balance_used > 0:
        await adjust_balance(session, order.user_id, order.balance_used, BalanceTxType.REFUND, order_id=order.id,
                             note=f"Order {order.number} cancelled — balance returned")
        order.total = money(order.total + order.balance_used)
        order.balance_used = Decimal("0")


async def cancel_order(
    session: AsyncSession, order: Order, *, reason: str, actor: str = "system", admin_id: int | None = None,
    expired: bool = False,
) -> Order:
    """Cancel/expire an unpaid order: release stock, return balance, cancel pending payments."""
    if order.status not in OPEN_ORDER_STATUSES:
        raise Conflict("Only unpaid orders can be cancelled", code="order_not_cancellable")
    await _release_resources(session, order)
    for p in order.payments:
        if p.status in (PaymentStatus.PENDING, PaymentStatus.AWAITING_CONFIRMATION):
            p.status = PaymentStatus.EXPIRED if expired else PaymentStatus.CANCELLED
    from app.payments.service import release_address_for_order

    await release_address_for_order(session, order.id)
    order.status = OrderStatus.EXPIRED if expired else OrderStatus.CANCELLED
    order.cancelled_at = utcnow()
    await add_order_event(session, order.id, "expired" if expired else "cancelled", reason, actor=actor,
                          admin_id=admin_id)
    await add_event(session, order.user_id, "order_cancelled", f"Order {order.number}: {reason}",
                    {"order_id": order.id}, admin_id=admin_id)
    oid, status = order.id, order.status.value
    on_commit(session, lambda: publish_admin_event("order.updated", {"id": oid, "status": status}))
    return order


async def get_order_full(session: AsyncSession, order_id: int) -> Order | None:
    return (
        await session.execute(
            select(Order).where(Order.id == order_id)
            .options(selectinload(Order.items), selectinload(Order.payments))
        )
    ).scalar_one_or_none()


async def latest_payment(order: Order) -> Payment | None:
    return order.payments[-1] if order.payments else None
