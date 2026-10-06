"""Order management."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Literal

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, Auth, Paging, Perm, page_response, paginate
from app.api.serializers import order_brief, order_out
from app.core.errors import NotFound, ValidationFailed
from app.fulfillment import service as fulfillment
from app.fulfillment.service import delivered_units
from app.models import Admin, Order, OrderEvent, OrderItem, Refund, User
from app.models.enums import OrderStatus
from app.payments import service as payments
from app.services.audit import audit
from app.services.orders import add_order_event, cancel_order, get_order_full, lock_order

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("")
async def list_orders(
    session: DB, auth: Perm("orders.view"), paging: Paging,
    status: str | None = None, q: str | None = None, payment_method: str | None = None,
    customer_id: int | None = None, product_id: int | None = None, delivery_status: str | None = None,
    date_from: date | None = None, date_to: date | None = None, sort: str = "-created_at",
) -> dict[str, Any]:
    query = select(Order).options(selectinload(Order.items))
    if status:
        statuses = [s for s in status.split(",") if s in OrderStatus._value2member_map_]
        if statuses:
            query = query.where(Order.status.in_(statuses))
    if delivery_status:
        query = query.where(Order.delivery_status == delivery_status)
    if payment_method:
        query = query.where(Order.payment_method == payment_method)
    if customer_id:
        query = query.where(Order.user_id == customer_id)
    if product_id:
        query = query.where(Order.id.in_(select(OrderItem.order_id).where(OrderItem.product_id == product_id)))
    if date_from:
        query = query.where(Order.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        query = query.where(Order.created_at < datetime.combine(date_to, time.max))
    if q:
        term = q.strip()
        user_ids = select(User.id).where(or_(User.username.ilike(f"%{term.lstrip('@')}%"),
                                             User.first_name.ilike(f"%{term}%"),
                                             User.telegram_id == (int(term) if term.isdigit() else -1)))
        query = query.where(or_(Order.number.ilike(f"%{term}%"), Order.user_id.in_(user_ids),
                                Order.id.in_(select(OrderItem.order_id).where(OrderItem.product_name.ilike(f"%{term}%")))))
    order_col = {"created_at": Order.created_at, "total": Order.total, "paid_at": Order.paid_at}.get(sort.lstrip("-"), Order.created_at)
    query = query.order_by(order_col.desc().nulls_last() if sort.startswith("-") else order_col.asc())
    items, total = await paginate(session, query, paging)
    return page_response([order_brief(o) for o in items], total, paging)


@router.get("/export")
async def export_orders(session: DB, auth: Perm("orders.view"), status: str | None = None,
                        date_from: date | None = None, date_to: date | None = None) -> StreamingResponse:
    query = select(Order).options(selectinload(Order.items)).order_by(Order.created_at.desc())
    if status:
        query = query.where(Order.status.in_(status.split(",")))
    if date_from:
        query = query.where(Order.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        query = query.where(Order.created_at < datetime.combine(date_to, time.max))
    rows = (await session.execute(query.limit(50000))).scalars().unique().all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["number", "created_at", "status", "delivery_status", "customer_telegram_id", "customer_username", "items",
                "subtotal", "discount", "balance_used", "total", "currency", "payment_method", "promo_code", "paid_at"])
    for o in rows:
        w.writerow([o.number, o.created_at.isoformat(), o.status.value, o.delivery_status.value, o.user.telegram_id,
                    o.user.username or "", "; ".join(f"{i.product_name} x{i.quantity}" for i in o.items), o.subtotal,
                    o.discount_total, o.balance_used, o.total, o.currency, o.payment_method or "", o.promo_code or "",
                    o.paid_at.isoformat() if o.paid_at else ""])
    await audit(session, auth.admin, "orders.export", f"Exported {len(rows)} orders")
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="orders.csv"'})


@router.get("/{order_id}")
async def get_order(order_id: int, session: DB, auth: Perm("orders.view")) -> dict[str, Any]:
    order = await get_order_full(session, order_id)
    if order is None:
        raise NotFound("Order not found")
    events = (await session.execute(select(OrderEvent).where(OrderEvent.order_id == order.id)
                                    .order_by(OrderEvent.created_at, OrderEvent.id))).scalars().all()
    admin_names = {a.id: a.name for a in (await session.execute(
        select(Admin).where(Admin.id.in_([e.admin_id for e in events if e.admin_id] or [0])))).scalars()}
    refunds = (await session.execute(select(Refund).where(Refund.order_id == order.id).order_by(Refund.created_at))).scalars().all()
    data = order_out(order)
    data["timeline"] = [{"id": e.id, "type": e.type, "message": e.message, "data": e.data, "actor": e.actor,
                         "admin": admin_names.get(e.admin_id) if e.admin_id else None, "created_at": e.created_at}
                        for e in events]
    data["refunds"] = [{"id": r.id, "amount": r.amount, "method": r.method, "reason": r.reason, "created_at": r.created_at,
                        "admin": admin_names.get(r.admin_id)} for r in refunds]
    can_reveal = auth.can("orders.manage")
    for item_data, item in zip(data["items"], order.items, strict=True):
        units = delivered_units(item)
        item_data["delivery"] = units if can_reveal else [{"type": u.get("type"), "value": "••••••"} for u in units]
    data["refundable"] = (order.total + order.balance_used) - order.refunded_amount
    return data


class NoteIn(BaseModel):
    note: str = Field(max_length=5000)


@router.patch("/{order_id}/notes")
async def update_notes(order_id: int, body: NoteIn, session: DB, auth: Perm("orders.manage")) -> dict[str, str]:
    order = await session.get(Order, order_id)
    if order is None:
        raise NotFound("Order not found")
    order.admin_notes = body.note
    await add_order_event(session, order.id, "note", "Admin note updated", actor="admin", admin_id=auth.admin.id)
    return {"status": "ok"}


class ReasonIn(BaseModel):
    reason: str | None = Field(None, max_length=500)


@router.post("/{order_id}/mark-paid")
async def mark_paid(order_id: int, body: ReasonIn, session: DB, auth: Perm("orders.mark_paid")) -> dict[str, str]:
    order = await payments.admin_mark_paid(session, order_id, auth.admin, body.reason)
    await audit(session, auth.admin, "order.mark_paid", f"Marked order {order.number} as paid manually",
                entity_type="order", entity_id=order.id, new={"reason": body.reason})
    return {"status": "ok"}


@router.post("/{order_id}/cancel")
async def cancel(order_id: int, body: ReasonIn, session: DB, auth: Perm("orders.manage")) -> dict[str, str]:
    order = await lock_order(session, order_id)
    if order is None:
        raise NotFound("Order not found")
    await cancel_order(session, order, reason=body.reason or "Cancelled by administrator", actor="admin",
                       admin_id=auth.admin.id)
    await audit(session, auth.admin, "order.cancel", f"Cancelled order {order.number}", entity_type="order",
                entity_id=order.id, new={"reason": body.reason})
    tg, lang, number = order.user.telegram_id, order.user.language, order.number

    async def _tell() -> None:
        from app.bot.notify import send_text
        from app.services.texts import t

        await send_text(tg, await t("order.cancelled_by_admin", lang, order=number))

    from app.core.database import on_commit

    on_commit(session, _tell)
    return {"status": "ok"}


class RefundIn(BaseModel):
    amount: Decimal = Field(gt=0)
    method: Literal["provider", "balance", "manual"]
    reason: str | None = Field(None, max_length=500)


@router.post("/{order_id}/refund")
async def refund(order_id: int, body: RefundIn, session: DB, auth: Perm("orders.refund")) -> dict[str, Any]:
    r = await payments.refund_order(session, order_id, amount=body.amount, method=body.method, reason=body.reason,
                                    admin=auth.admin)
    await audit(session, auth.admin, "order.refund", f"Refunded {body.amount} ({body.method})", entity_type="order",
                entity_id=order_id, new=body.model_dump())
    return {"status": "ok", "refund_id": r.id}


@router.post("/{order_id}/resend")
async def resend(order_id: int, session: DB, auth: Perm("orders.manage")) -> dict[str, Any]:
    await audit(session, auth.admin, "order.resend", "Re-sent delivery to customer", entity_type="order", entity_id=order_id)
    await session.commit()
    n = await fulfillment.resend(order_id)
    return {"status": "ok", "items": n}


@router.post("/{order_id}/fulfill")
async def retry_fulfillment(order_id: int, session: DB, auth: Perm("orders.manage")) -> dict[str, Any]:
    await audit(session, auth.admin, "order.fulfill_retry", "Retried automatic fulfillment", entity_type="order",
                entity_id=order_id)
    await session.commit()
    return await fulfillment.fulfill_order(order_id)


class DeliverIn(BaseModel):
    order_item_id: int
    contents: list[str] = Field(min_length=1, max_length=500)


@router.post("/{order_id}/deliver")
async def deliver(order_id: int, body: DeliverIn, session: DB, auth: Perm("orders.manage")) -> dict[str, str]:
    item = await session.get(OrderItem, body.order_item_id)
    if item is None or item.order_id != order_id:
        raise ValidationFailed("Item does not belong to this order")
    await fulfillment.deliver_manually(session, body.order_item_id, body.contents, auth.admin)
    await audit(session, auth.admin, "order.deliver_manual", f"Manually delivered {item.product_name}",
                entity_type="order", entity_id=order_id, new={"items": len(body.contents)})
    return {"status": "ok"}


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/{order_id}/message")
async def message_customer(order_id: int, body: MessageIn, session: DB, auth: Perm("customers.edit")) -> dict[str, Any]:
    from app.bot.notify import send_text
    from app.security.html import sanitize_telegram_html

    order = await session.get(Order, order_id)
    if order is None:
        raise NotFound("Order not found")
    ok = await send_text(order.user.telegram_id, sanitize_telegram_html(body.text))
    await add_order_event(session, order.id, "message", "Message sent to customer" if ok else "Message delivery failed",
                          actor="admin", admin_id=auth.admin.id, data={"text": body.text[:500]})
    return {"status": "ok" if ok else "failed"}


@router.post("/{order_id}/check-payment")
async def check_payment(order_id: int, session: DB, auth: Auth) -> dict[str, Any]:
    order = await get_order_full(session, order_id)
    if order is None:
        raise NotFound("Order not found")
    results = []
    for p in order.payments:
        if p.status.value in ("pending", "awaiting_confirmation"):
            try:
                updated = await payments.refresh_payment(session, p.id)
                results.append({"id": str(p.id), "status": updated.status.value})
            except Exception as exc:
                results.append({"id": str(p.id), "error": str(exc)[:200]})
    return {"results": results}
