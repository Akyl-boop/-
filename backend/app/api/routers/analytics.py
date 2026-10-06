"""Dashboard & analytics endpoints."""

from __future__ import annotations

import csv
import io
from datetime import date
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select

from app.api.deps import DB, Perm
from app.models import Order
from app.services import analytics

router = APIRouter(tags=["analytics"])


@router.get("/dashboard")
async def dashboard(session: DB, auth: Perm("dashboard.view"), range: str = "30d",  # noqa: A002
                    date_from: date | None = None, date_to: date | None = None) -> dict[str, Any]:
    period = await analytics.resolve_period(range, date_from, date_to)
    return await analytics.overview(session, period, include_revenue=auth.can("revenue.view"))


@router.get("/analytics")
async def analytics_report(session: DB, auth: Perm("analytics.view"), range: str = "30d",  # noqa: A002
                           date_from: date | None = None, date_to: date | None = None) -> dict[str, Any]:
    period = await analytics.resolve_period(range, date_from, date_to)
    base = await analytics.overview(session, period, include_revenue=auth.can("revenue.view"))
    return {**base, "advanced": await analytics.advanced(session, period)}


@router.get("/analytics/export")
async def analytics_export(session: DB, auth: Perm("analytics.export"), kind: str = Query("daily", pattern="^(daily|orders)$"),
                           range: str = "30d", date_from: date | None = None, date_to: date | None = None) -> StreamingResponse:  # noqa: A002
    period = await analytics.resolve_period(range, date_from, date_to)
    buf = io.StringIO()
    w = csv.writer(buf)
    if kind == "daily":
        data = await analytics.overview(session, period, include_revenue=auth.can("revenue.view"))
        w.writerow(["date", "revenue", "paid_orders", "created_orders", "new_customers"])
        for s in data["series"]:
            w.writerow([s["date"], s["revenue"], s["orders"], s["created"], s["customers"]])
    else:
        rows = (await session.execute(select(Order).where(Order.created_at >= period.start, Order.created_at < period.end)
                                      .order_by(Order.created_at))).scalars().all()
        w.writerow(["number", "created_at", "status", "customer_telegram_id", "total", "currency", "payment_method", "paid_at"])
        for o in rows:
            w.writerow([o.number, o.created_at.isoformat(), o.status.value, o.user.telegram_id, o.total + o.balance_used,
                        o.currency, o.payment_method or "", o.paid_at.isoformat() if o.paid_at else ""])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="analytics-{kind}-{period.key}.csv"'})
