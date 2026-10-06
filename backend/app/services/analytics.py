"""Analytics computed from real data with period-over-period comparison."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import Date, case, cast, distinct, func, literal_column, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationFailed
from app.core.redis import cache_get, cache_set
from app.models import (
    Category,
    InventoryItem,
    Order,
    OrderItem,
    Payment,
    Product,
    PromoCode,
    PromoUsage,
    Referral,
    ReferralReward,
    Refund,
    User,
)
from app.models.enums import InventoryStatus, OrderStatus, ProductStatus, StockMode
from app.services.settings import settings_store

REVENUE_STATUSES = (OrderStatus.PAID, OrderStatus.PROCESSING, OrderStatus.COMPLETED, OrderStatus.REFUNDED,
                    OrderStatus.PARTIALLY_REFUNDED)


@dataclass
class Period:
    start: datetime
    end: datetime
    tz: str
    key: str

    @property
    def previous(self) -> Period:
        span = self.end - self.start
        return Period(self.start - span, self.start, self.tz, "previous")

    @property
    def days(self) -> int:
        return max(1, round((self.end - self.start).total_seconds() / 86400))


async def resolve_period(range_key: str = "30d", date_from: date | None = None, date_to: date | None = None) -> Period:
    tz_name = await settings_store.get("general.timezone", "UTC") or "UTC"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("UTC")
        tz_name = "UTC"
    now = datetime.now(tz)
    today = datetime.combine(now.date(), time.min, tz)
    if range_key == "custom":
        if not date_from or not date_to or date_from > date_to:
            raise ValidationFailed("Invalid custom date range")
        start = datetime.combine(date_from, time.min, tz)
        end = datetime.combine(date_to + timedelta(days=1), time.min, tz)
    elif range_key == "today":
        start, end = today, today + timedelta(days=1)
    elif range_key == "yesterday":
        start, end = today - timedelta(days=1), today
    elif range_key == "this_month":
        start = today.replace(day=1)
        end = today + timedelta(days=1)
    elif range_key == "last_month":
        first_this = today.replace(day=1)
        end = first_this
        start = (first_this - timedelta(days=1)).replace(day=1)
    else:
        days = {"7d": 7, "30d": 30, "90d": 90, "365d": 365}.get(range_key, 30)
        start, end = today - timedelta(days=days - 1), today + timedelta(days=1)
    return Period(start, end, tz_name, range_key)


def _pct(cur: float, prev: float) -> float | None:
    if prev == 0:
        return None if cur == 0 else 100.0
    return round((cur - prev) / abs(prev) * 100, 1)


def _f(v: Any) -> float:
    return float(v or 0)


async def _kpis(session: AsyncSession, p: Period) -> dict[str, float]:
    paid_in = (Order.paid_at >= p.start, Order.paid_at < p.end, Order.status.in_(REVENUE_STATUSES))
    row = (await session.execute(select(
        func.coalesce(func.sum(Order.total + Order.balance_used), 0),
        func.count(Order.id),
        func.coalesce(func.sum(case((Order.cost_total.is_not(None), Order.total + Order.balance_used - Order.cost_total),
                                    else_=0)), 0),
        func.coalesce(func.sum(case((Order.cost_total.is_not(None), Order.total + Order.balance_used), else_=0)), 0),
        func.count(distinct(Order.user_id)),
    ).where(*paid_in))).one()
    gross, paid_orders, profit, profit_base, buyers = _f(row[0]), _f(row[1]), _f(row[2]), _f(row[3]), _f(row[4])
    refunds = _f((await session.execute(select(func.coalesce(func.sum(Refund.amount), 0))
                                        .where(Refund.created_at >= p.start, Refund.created_at < p.end))).scalar_one())
    refunded_orders = _f((await session.execute(select(func.count(distinct(Refund.order_id)))
                                                .where(Refund.created_at >= p.start, Refund.created_at < p.end))).scalar_one())
    created = _f((await session.execute(select(func.count(Order.id))
                                        .where(Order.created_at >= p.start, Order.created_at < p.end))).scalar_one())
    new_customers = _f((await session.execute(select(func.count(User.id))
                                              .where(User.created_at >= p.start, User.created_at < p.end))).scalar_one())
    sold = _f((await session.execute(select(func.coalesce(func.sum(OrderItem.quantity), 0)).join(Order, Order.id == OrderItem.order_id)
                                     .where(*paid_in))).scalar_one())
    pay_rows = (await session.execute(select(Payment.status, func.count()).where(
        Payment.created_at >= p.start, Payment.created_at < p.end).group_by(Payment.status))).all()
    pay = {s.value if hasattr(s, "value") else s: int(c) for s, c in pay_rows}
    paid_payments = pay.get("paid", 0) + pay.get("refunded", 0) + pay.get("partially_refunded", 0)
    failed_payments = pay.get("failed", 0) + pay.get("expired", 0)
    finished = paid_payments + failed_payments + pay.get("cancelled", 0)
    return {
        "revenue": round(gross - refunds, 2), "gross_revenue": round(gross, 2), "refunds": round(refunds, 2),
        "orders": paid_orders, "orders_created": created, "aov": round(gross / paid_orders, 2) if paid_orders else 0.0,
        "conversion_rate": round(paid_orders / created * 100, 1) if created else 0.0, "new_customers": new_customers,
        "buyers": buyers, "products_sold": sold, "failed_payments": failed_payments, "refunded_orders": refunded_orders,
        "profit": round(profit, 2), "margin": round(profit / profit_base * 100, 1) if profit_base else 0.0,
        "refund_rate": round(refunded_orders / paid_orders * 100, 1) if paid_orders else 0.0,
        "payment_success_rate": round(paid_payments / finished * 100, 1) if finished else 0.0,
    }


async def _series(session: AsyncSession, p: Period) -> list[dict[str, Any]]:
    tz = p.tz
    day = cast(func.timezone(tz, Order.paid_at), Date)
    rows = (await session.execute(
        select(day.label("d"), func.coalesce(func.sum(Order.total + Order.balance_used), 0), func.count(Order.id))
        .where(Order.paid_at >= p.start, Order.paid_at < p.end, Order.status.in_(REVENUE_STATUSES))
        .group_by(literal_column("d"))
    )).all()
    created_day = cast(func.timezone(tz, Order.created_at), Date)
    created_rows = (await session.execute(
        select(created_day.label("d"), func.count(Order.id))
        .where(Order.created_at >= p.start, Order.created_at < p.end).group_by(literal_column("d"))
    )).all()
    cust_day = cast(func.timezone(tz, User.created_at), Date)
    cust_rows = (await session.execute(
        select(cust_day.label("d"), func.count(User.id))
        .where(User.created_at >= p.start, User.created_at < p.end).group_by(literal_column("d"))
    )).all()
    by_day = {r[0]: (_f(r[1]), int(r[2])) for r in rows}
    created_by = {r[0]: int(r[1]) for r in created_rows}
    cust_by = {r[0]: int(r[1]) for r in cust_rows}
    out = []
    d = p.start.date()
    end = (p.end - timedelta(seconds=1)).date()
    while d <= end:
        rev, cnt = by_day.get(d, (0.0, 0))
        out.append({"date": d.isoformat(), "revenue": round(rev, 2), "orders": cnt, "created": created_by.get(d, 0),
                    "customers": cust_by.get(d, 0)})
        d += timedelta(days=1)
    return out


async def overview(session: AsyncSession, period: Period, *, include_revenue: bool = True) -> dict[str, Any]:
    cache_key = f"analytics:overview:{period.key}:{period.start.isoformat()}:{period.end.isoformat()}:{include_revenue}"
    cached = await cache_get(cache_key)
    if cached:
        return cached
    cur = await _kpis(session, period)
    prev = await _kpis(session, period.previous)
    kpis = {k: {"value": v, "previous": prev.get(k, 0), "change": _pct(v, prev.get(k, 0))} for k, v in cur.items()}
    totals = {
        "customers": int((await session.execute(select(func.count(User.id)))).scalar_one()),
        "pending_orders": int((await session.execute(select(func.count(Order.id)).where(
            Order.status.in_([OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT, OrderStatus.AWAITING_CONFIRMATION]))))
            .scalar_one()),
        "processing_orders": int((await session.execute(select(func.count(Order.id)).where(
            Order.status == OrderStatus.PROCESSING))).scalar_one()),
        "stock_alerts": await stock_alert_count(session),
    }
    series = await _series(session, period)
    paid_in = (Order.paid_at >= period.start, Order.paid_at < period.end, Order.status.in_(REVENUE_STATUSES))

    top_products = (await session.execute(
        select(OrderItem.product_id, func.max(OrderItem.product_name), func.sum(OrderItem.quantity), func.sum(OrderItem.total))
        .join(Order, Order.id == OrderItem.order_id).where(*paid_in)
        .group_by(OrderItem.product_id).order_by(func.sum(OrderItem.total).desc()).limit(8)
    )).all()
    by_category = (await session.execute(
        select(Category.id, Category.name, func.sum(OrderItem.total))
        .select_from(OrderItem).join(Order, Order.id == OrderItem.order_id)
        .join(Category, Category.id == OrderItem.category_id, isouter=True)
        .where(*paid_in).group_by(Category.id, Category.name).order_by(func.sum(OrderItem.total).desc()).limit(8)
    )).all()
    by_method = (await session.execute(
        select(Order.payment_method, func.count(Order.id), func.sum(Order.total + Order.balance_used))
        .where(*paid_in).group_by(Order.payment_method).order_by(func.count(Order.id).desc())
    )).all()
    top_customers = (await session.execute(
        select(User.id, User.first_name, User.username, func.count(Order.id), func.sum(Order.total + Order.balance_used))
        .join(Order, Order.user_id == User.id).where(*paid_in)
        .group_by(User.id).order_by(func.sum(Order.total + Order.balance_used).desc()).limit(8)
    )).all()
    # New vs returning buyers: first paid order inside the period vs before it
    nv = (await session.execute(
        select(
            func.count(distinct(case((User.first_order_at >= period.start, Order.user_id)))),
            func.count(distinct(case((User.first_order_at < period.start, Order.user_id)))),
        ).join(User, User.id == Order.user_id).where(*paid_in)
    )).one()
    langs = (await session.execute(select(User.language, func.count(User.id)).group_by(User.language)
                                   .order_by(func.count(User.id).desc()))).all()
    recent = (await session.execute(
        select(Order).order_by(Order.created_at.desc()).limit(8)
    )).scalars().all()

    def money_or_hidden(v: Any) -> float | None:
        return round(_f(v), 2) if include_revenue else None

    result = {
        "period": {"key": period.key, "start": period.start.isoformat(), "end": period.end.isoformat(), "tz": period.tz},
        "kpis": kpis if include_revenue else {k: v for k, v in kpis.items() if k not in
                                              ("revenue", "gross_revenue", "refunds", "aov", "profit", "margin")},
        "totals": totals,
        "series": [s if include_revenue else {**s, "revenue": None} for s in series],
        "top_products": [{"product_id": r[0], "name": r[1], "quantity": int(r[2] or 0), "revenue": money_or_hidden(r[3])}
                         for r in top_products],
        "revenue_by_category": [{"category_id": r[0], "name": (r[1] or {}).get("en") if r[1] else "Uncategorized",
                                 "revenue": money_or_hidden(r[2])} for r in by_category],
        "payment_methods": [{"method": r[0] or "unknown", "orders": int(r[1]), "revenue": money_or_hidden(r[2])}
                            for r in by_method],
        "top_customers": [{"user_id": r[0], "name": r[1] or (f"@{r[2]}" if r[2] else f"#{r[0]}"), "username": r[2],
                           "orders": int(r[3]), "revenue": money_or_hidden(r[4])} for r in top_customers],
        "new_vs_returning": {"new": int(nv[0] or 0), "returning": int(nv[1] or 0)},
        "languages": [{"language": r[0], "customers": int(r[1])} for r in langs],
        "recent_orders": [{"id": o.id, "number": o.number, "status": o.status.value, "total": money_or_hidden(o.total + o.balance_used),
                           "currency": o.currency, "customer": o.user.display_name, "created_at": o.created_at.isoformat()}
                          for o in recent],
    }
    await cache_set(cache_key, result, ttl=30)
    return result


async def stock_alert_count(session: AsyncSession) -> int:
    rows = (await session.execute(
        select(Product.id, Product.low_stock_threshold, func.count(InventoryItem.id))
        .select_from(Product)
        .join(InventoryItem, (InventoryItem.product_id == Product.id) & (InventoryItem.status == InventoryStatus.AVAILABLE),
              isouter=True)
        .where(Product.deleted_at.is_(None), Product.stock_mode == StockMode.INVENTORY,
               Product.status.in_([ProductStatus.ACTIVE, ProductStatus.OUT_OF_STOCK]))
        .group_by(Product.id)
    )).all()
    return sum(1 for _, threshold, count in rows if count <= threshold)


async def advanced(session: AsyncSession, period: Period) -> dict[str, Any]:
    paid_in = (Order.paid_at >= period.start, Order.paid_at < period.end, Order.status.in_(REVENUE_STATUSES))
    # Retention: buyers in period that bought more than once (ever)
    repeat = (await session.execute(text(
        "SELECT count(*) FILTER (WHERE paid_orders_count >= 2), count(*) FILTER (WHERE paid_orders_count >= 1) FROM users"
    ))).one()
    cohort = (await session.execute(text("""
        SELECT to_char(date_trunc('month', first_order_at), 'YYYY-MM') AS cohort,
               count(*) AS customers,
               count(*) FILTER (WHERE paid_orders_count >= 2) AS repeat
        FROM users WHERE first_order_at IS NOT NULL
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12
    """))).all()
    promo = (await session.execute(
        select(PromoCode.code, func.count(PromoUsage.id), func.coalesce(func.sum(PromoUsage.discount), 0),
               func.coalesce(func.sum(PromoUsage.order_total), 0))
        .join(PromoUsage, PromoUsage.promo_id == PromoCode.id)
        .where(PromoUsage.created_at >= period.start, PromoUsage.created_at < period.end)
        .group_by(PromoCode.code).order_by(func.count(PromoUsage.id).desc()).limit(10)
    )).all()
    ref = (await session.execute(select(
        func.count(Referral.id),
        func.count(Referral.converted_at),
        func.coalesce(func.sum(Referral.revenue), 0),
    ).where(Referral.created_at >= period.start, Referral.created_at < period.end))).one()
    rewards = _f((await session.execute(select(func.coalesce(func.sum(ReferralReward.amount), 0)).where(
        ReferralReward.created_at >= period.start, ReferralReward.created_at < period.end))).scalar_one())
    by_category = (await session.execute(
        select(Category.name, func.sum(OrderItem.quantity), func.sum(OrderItem.total),
               func.sum(OrderItem.total - func.coalesce(OrderItem.unit_cost, 0) * OrderItem.quantity))
        .select_from(OrderItem).join(Order, Order.id == OrderItem.order_id)
        .join(Category, Category.id == OrderItem.category_id, isouter=True).where(*paid_in)
        .group_by(Category.name).order_by(func.sum(OrderItem.total).desc())
    )).all()
    hours = (await session.execute(
        select(func.extract("hour", func.timezone(period.tz, Order.paid_at)).label("h"), func.count(Order.id))
        .where(*paid_in).group_by(literal_column("h")).order_by(literal_column("h"))
    )).all()
    return {
        "retention": {"repeat_customers": int(repeat[0] or 0), "buyers": int(repeat[1] or 0),
                      "repeat_rate": round(int(repeat[0] or 0) / int(repeat[1]) * 100, 1) if repeat[1] else 0.0},
        "cohorts": [{"cohort": r[0], "customers": int(r[1]), "repeat": int(r[2])} for r in cohort],
        "promo_performance": [{"code": r[0], "uses": int(r[1]), "discount": round(_f(r[2]), 2), "revenue": round(_f(r[3]), 2)}
                              for r in promo],
        "referral_performance": {"registered": int(ref[0]), "converted": int(ref[1]), "revenue": round(_f(ref[2]), 2),
                                 "rewards": round(rewards, 2)},
        "categories": [{"name": (r[0] or {}).get("en") if r[0] else "Uncategorized", "quantity": int(r[1] or 0),
                        "revenue": round(_f(r[2]), 2), "profit": round(_f(r[3]), 2)} for r in by_category],
        "hours": [{"hour": int(r[0]), "orders": int(r[1])} for r in hours],
    }


__all__ = ["Decimal", "overview", "advanced", "resolve_period"]
