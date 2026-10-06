"""Support tickets (dashboard side)."""

from __future__ import annotations

import io
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.api.deps import DB, Paging, Perm, page_response, paginate
from app.api.serializers import order_brief, ticket_out, user_out
from app.core.errors import NotFound, ServiceUnavailable
from app.models import Admin, Order, Ticket, TicketMessage, User
from app.models.enums import TicketPriority, TicketStatus
from app.services import support as support_service
from app.services.audit import audit

router = APIRouter(prefix="/support", tags=["support"])


@router.get("/tickets")
async def list_tickets(session: DB, auth: Perm("support.view"), paging: Paging, status: str | None = None,
                       priority: str | None = None, assigned: str | None = None, q: str | None = None) -> dict[str, Any]:
    query = select(Ticket).order_by(Ticket.unread_by_admin.desc(), Ticket.last_message_at.desc().nulls_last())
    if status:
        query = query.where(Ticket.status.in_(status.split(",")))
    if priority:
        query = query.where(Ticket.priority == priority)
    if assigned == "me":
        query = query.where(Ticket.assigned_admin_id == auth.admin.id)
    elif assigned == "none":
        query = query.where(Ticket.assigned_admin_id.is_(None))
    if q:
        term = q.strip().lstrip("@")
        query = query.where(or_(Ticket.number.ilike(f"%{term}%"), Ticket.subject.ilike(f"%{term}%"),
                                Ticket.user_id.in_(select(User.id).where(User.username.ilike(f"%{term}%")))))
    items, total = await paginate(session, query, paging)
    last = {}
    if items:
        rows = (await session.execute(
            select(TicketMessage.ticket_id, TicketMessage.body, TicketMessage.sender)
            .distinct(TicketMessage.ticket_id)
            .where(TicketMessage.ticket_id.in_([t.id for t in items]))
            .order_by(TicketMessage.ticket_id, TicketMessage.created_at.desc())
        )).all()
        last = {r[0]: {"body": r[1][:160], "sender": r[2]} for r in rows}
    out = []
    for t in items:
        d = ticket_out(t)
        d["last_message"] = last.get(t.id)
        out.append(d)
    counts = dict((await session.execute(select(Ticket.status, func.count()).group_by(Ticket.status))).all())
    resp = page_response(out, total, paging)
    resp["counts"] = {(k.value if hasattr(k, "value") else k): v for k, v in counts.items()}
    resp["unread"] = (await session.execute(select(func.count()).select_from(Ticket).where(Ticket.unread_by_admin.is_(True)))).scalar_one()
    return resp


@router.get("/tickets/{ticket_id}")
async def get_ticket(ticket_id: int, session: DB, auth: Perm("support.view")) -> dict[str, Any]:
    t = await session.get(Ticket, ticket_id)
    if t is None:
        raise NotFound("Ticket not found")
    msgs = (await session.execute(select(TicketMessage).where(TicketMessage.ticket_id == t.id)
                                  .order_by(TicketMessage.created_at, TicketMessage.id))).scalars().all()
    admins = {a.id: a.name for a in (await session.execute(select(Admin))).scalars()}
    order = await session.get(Order, t.order_id) if t.order_id else None
    recent_orders = (await session.execute(select(Order).where(Order.user_id == t.user_id)
                                           .order_by(Order.created_at.desc()).limit(5))).scalars().all()
    if t.unread_by_admin:
        t.unread_by_admin = False
    return {
        **ticket_out(t), "customer_full": user_out(t.user), "order": order_brief(order) if order else None,
        "recent_orders": [order_brief(o) for o in recent_orders],
        "assigned_admin": admins.get(t.assigned_admin_id) if t.assigned_admin_id else None,
        "messages": [{"id": m.id, "sender": m.sender, "admin": admins.get(m.admin_id) if m.admin_id else None,
                      "body": m.body, "attachments": [{"type": a.get("type"), "name": a.get("name"), "index": i}
                                                      for i, a in enumerate(m.attachments or [])],
                      "delivered": m.delivered, "created_at": m.created_at} for m in msgs],
        "admins": [{"id": k, "name": v} for k, v in admins.items()],
    }


class ReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    close: bool = False


@router.post("/tickets/{ticket_id}/reply")
async def reply(ticket_id: int, body: ReplyIn, session: DB, auth: Perm("support.reply")) -> dict[str, Any]:
    t = await session.get(Ticket, ticket_id)
    if t is None:
        raise NotFound("Ticket not found")
    msg = await support_service.admin_reply(session, t, auth.admin, body.body, close=body.close)
    return {"id": msg.id, "status": t.status.value}


class TicketUpdateIn(BaseModel):
    status: TicketStatus | None = None
    priority: TicketPriority | None = None
    assigned_admin_id: int | None = Field(None)
    unassign: bool = False


@router.patch("/tickets/{ticket_id}")
async def update_ticket(ticket_id: int, body: TicketUpdateIn, session: DB, auth: Perm("support.reply")) -> dict[str, Any]:
    t = await session.get(Ticket, ticket_id)
    if t is None:
        raise NotFound("Ticket not found")
    if body.status is not None:
        if body.status == TicketStatus.CLOSED:
            await support_service.close_ticket(session, t)
        else:
            t.status = body.status
    if body.priority is not None:
        t.priority = body.priority
    if body.unassign:
        t.assigned_admin_id = None
    elif body.assigned_admin_id is not None:
        t.assigned_admin_id = body.assigned_admin_id
    await audit(session, auth.admin, "ticket.update", f"Updated ticket {t.number}", entity_type="ticket", entity_id=t.id,
                new=body.model_dump(exclude_none=True))
    return ticket_out(t)


@router.get("/tickets/{ticket_id}/attachments/{message_id}/{index}")
async def attachment(ticket_id: int, message_id: int, index: int, session: DB, auth: Perm("support.view")) -> StreamingResponse:
    m = await session.get(TicketMessage, message_id)
    if m is None or m.ticket_id != ticket_id or index >= len(m.attachments or []):
        raise NotFound("Attachment not found")
    att = m.attachments[index]
    try:
        from app.bot.instance import get_bot

        bot = get_bot()
        file = await bot.get_file(att["file_id"])
        buf = io.BytesIO()
        await bot.download_file(file.file_path, buf)  # type: ignore[arg-type]
    except Exception as exc:
        raise ServiceUnavailable(f"Could not fetch attachment from Telegram: {exc}") from exc
    media_type = {"photo": "image/jpeg", "video": "video/mp4"}.get(att.get("type"), "application/octet-stream")
    name = att.get("name") or f"attachment-{message_id}-{index}"
    return StreamingResponse(iter([buf.getvalue()]), media_type=media_type,
                             headers={"Content-Disposition": f'inline; filename="{name}"',
                                      "Cache-Control": "private, max-age=3600"})
