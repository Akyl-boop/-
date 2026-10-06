"""Promo code validation and discount calculation."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import PromoError
from app.core.utils import money, utcnow
from app.models import Order, PromoCode, PromoUsage, User
from app.models.enums import OPEN_ORDER_STATUSES, PAID_ORDER_STATUSES, PromoType


@dataclass
class PricedLine:
    product_id: int
    category_id: int | None
    total: Decimal


@dataclass
class PromoResult:
    promo: PromoCode
    discount: Decimal
    applicable_subtotal: Decimal


def calculate_discount(promo: PromoCode, lines: list[PricedLine]) -> tuple[Decimal, Decimal]:
    """Return (discount, applicable_subtotal) — pure function, unit-tested."""
    applicable = Decimal("0")
    for line in lines:
        product_ok = not promo.product_ids or line.product_id in promo.product_ids
        category_ok = not promo.category_ids or (line.category_id is not None and line.category_id in promo.category_ids)
        if promo.product_ids and promo.category_ids:
            ok = (line.product_id in promo.product_ids) or (
                line.category_id is not None and line.category_id in promo.category_ids
            )
        else:
            ok = product_ok and category_ok
        if ok:
            applicable += line.total
    if applicable <= 0:
        return Decimal("0"), Decimal("0")
    if promo.type == PromoType.PERCENT:
        discount = applicable * min(promo.value, Decimal("100")) / Decimal("100")
    else:
        discount = promo.value
    if promo.max_discount is not None and promo.max_discount > 0:
        discount = min(discount, promo.max_discount)
    discount = min(discount, applicable)
    return money(discount), money(applicable)


async def find_promo(session: AsyncSession, code: str) -> PromoCode | None:
    code = (code or "").strip().upper()
    if not code or len(code) > 48:
        return None
    return (await session.execute(select(PromoCode).where(func.upper(PromoCode.code) == code))).scalar_one_or_none()


async def validate_promo(
    session: AsyncSession, promo: PromoCode | None, user: User, lines: list[PricedLine], *,
    exclude_order_id: int | None = None,
) -> PromoResult:
    """Raise PromoError(code=<text key>) or return the computed discount."""
    if promo is None:
        raise PromoError("Promo code not found", code="promo.not_found")
    now = utcnow()
    if not promo.enabled:
        raise PromoError("Promo disabled", code="promo.disabled")
    if promo.starts_at and promo.starts_at > now:
        raise PromoError("Promo not started", code="promo.not_started")
    if promo.expires_at and promo.expires_at <= now:
        raise PromoError("Promo expired", code="promo.expired")
    if promo.max_uses is not None and promo.uses_count >= promo.max_uses:
        raise PromoError("Promo exhausted", code="promo.exhausted")
    if promo.user_ids and user.id not in promo.user_ids and user.telegram_id not in promo.user_ids:
        raise PromoError("Promo not allowed", code="promo.not_allowed")
    if promo.new_customers_only and user.paid_orders_count > 0:
        raise PromoError("New customers only", code="promo.new_only")
    if promo.max_uses_per_user is not None:
        used = (
            await session.execute(
                select(func.count()).select_from(PromoUsage)
                .where(PromoUsage.promo_id == promo.id, PromoUsage.user_id == user.id)
            )
        ).scalar_one()
        pending_q = select(func.count()).select_from(Order).where(
            Order.promo_code_id == promo.id, Order.user_id == user.id, Order.status.in_(OPEN_ORDER_STATUSES)
        )
        if exclude_order_id:
            pending_q = pending_q.where(Order.id != exclude_order_id)
        pending = (await session.execute(pending_q)).scalar_one()
        if used + pending >= promo.max_uses_per_user:
            raise PromoError("Per-user limit", code="promo.user_limit")
    discount, applicable = calculate_discount(promo, lines)
    if applicable <= 0:
        raise PromoError("Not applicable", code="promo.not_applicable")
    if promo.min_purchase and applicable < promo.min_purchase:
        raise PromoError("Minimum purchase", code="promo.min_purchase", details={"amount": str(promo.min_purchase)})
    return PromoResult(promo=promo, discount=discount, applicable_subtotal=applicable)


async def record_usage(session: AsyncSession, order: Order) -> None:
    """Idempotently record promo usage for a paid order."""
    if not order.promo_code_id or order.discount_total <= 0:
        return
    exists = (
        await session.execute(
            select(PromoUsage.id).where(PromoUsage.promo_id == order.promo_code_id, PromoUsage.order_id == order.id)
        )
    ).first()
    if exists:
        return
    session.add(PromoUsage(promo_id=order.promo_code_id, user_id=order.user_id, order_id=order.id,
                           discount=order.discount_total, order_total=order.total))
    promo = await session.get(PromoCode, order.promo_code_id, with_for_update=True)
    if promo is not None:
        promo.uses_count += 1


async def promo_stats(session: AsyncSession, promo_id: int) -> dict[str, object]:
    row = (
        await session.execute(
            select(func.count(PromoUsage.id), func.coalesce(func.sum(PromoUsage.discount), 0),
                   func.coalesce(func.sum(PromoUsage.order_total), 0), func.count(func.distinct(PromoUsage.user_id)))
            .where(PromoUsage.promo_id == promo_id)
        )
    ).one()
    return {"uses": int(row[0]), "discount_total": str(row[1]), "revenue": str(row[2]), "customers": int(row[3])}


PAID = PAID_ORDER_STATUSES
