"""Broadcast campaigns."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from app.api.deps import DB, Paging, Perm, page_response, paginate
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.queue import enqueue
from app.core.utils import utcnow
from app.models import Broadcast, BroadcastRecipient, Media, User
from app.models.enums import BroadcastStatus
from app.security.html import sanitize_telegram_html
from app.services import broadcasts as svc
from app.services.audit import audit
from app.services.settings import settings_store

router = APIRouter(prefix="/broadcasts", tags=["broadcasts"])


class BroadcastIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    text: dict[str, str]
    media_id: uuid.UUID | None = None
    buttons: list[dict[str, Any]] = Field(default_factory=list, max_length=10)
    audience: dict[str, Any] = Field(default_factory=lambda: {"type": "all"})
    disable_notification: bool = False
    protect_content: bool = False


def out(b: Broadcast) -> dict[str, Any]:
    return {"id": b.id, "name": b.name, "status": b.status.value, "text": b.text,
            "media_id": str(b.media_id) if b.media_id else None, "buttons": b.buttons, "audience": b.audience,
            "disable_notification": b.disable_notification, "protect_content": b.protect_content,
            "scheduled_at": b.scheduled_at, "started_at": b.started_at, "finished_at": b.finished_at,
            "total_count": b.total_count, "sent_count": b.sent_count, "failed_count": b.failed_count,
            "blocked_count": b.blocked_count, "created_at": b.created_at, "updated_at": b.updated_at}


async def _feature() -> None:
    if not await settings_store.feature("broadcasts"):
        raise ValidationFailed("Broadcasts are disabled in Settings → Features")


@router.get("")
async def list_broadcasts(session: DB, auth: Perm("broadcasts.send"), paging: Paging) -> dict[str, Any]:
    items, total = await paginate(session, select(Broadcast).order_by(Broadcast.created_at.desc()), paging)
    return page_response([out(b) for b in items], total, paging)


@router.post("/audience-count")
async def audience_count(body: dict[str, Any], session: DB, auth: Perm("broadcasts.send")) -> dict[str, int]:
    return {"count": await svc.count_audience(session, body)}


def _apply(b: Broadcast, body: BroadcastIn) -> None:
    if not any((v or "").strip() for v in body.text.values()) and not body.media_id:
        raise ValidationFailed("Add a message text or media")
    b.name = body.name
    b.text = {k: sanitize_telegram_html(v) for k, v in body.text.items() if v}
    b.media_id = body.media_id
    b.buttons = body.buttons
    b.audience = body.audience
    b.disable_notification, b.protect_content = body.disable_notification, body.protect_content


@router.post("", status_code=201)
async def create(body: BroadcastIn, session: DB, auth: Perm("broadcasts.send")) -> dict[str, Any]:
    b = Broadcast(name="", text={}, created_by=auth.admin.id)
    _apply(b, body)
    session.add(b)
    await session.flush()
    await audit(session, auth.admin, "broadcast.create", f"Created broadcast “{b.name}”", entity_type="broadcast", entity_id=b.id)
    return out(b)


async def _get(session: Any, bid: int) -> Broadcast:
    b = await session.get(Broadcast, bid)
    if b is None:
        raise NotFound("Broadcast not found")
    return b


@router.get("/{bid}")
async def get(bid: int, session: DB, auth: Perm("broadcasts.send")) -> dict[str, Any]:
    b = await _get(session, bid)
    stats = dict((await session.execute(select(BroadcastRecipient.status, func.count())
                                        .where(BroadcastRecipient.broadcast_id == b.id)
                                        .group_by(BroadcastRecipient.status))).all())
    return {**out(b), "recipient_stats": {(k.value if hasattr(k, "value") else k): v for k, v in stats.items()},
            "audience_size": await svc.count_audience(session, b.audience or {})}


@router.get("/{bid}/recipients")
async def recipients(bid: int, session: DB, auth: Perm("broadcasts.send"), paging: Paging, status: str | None = None) -> dict[str, Any]:
    q = (select(BroadcastRecipient, User).join(User, User.id == BroadcastRecipient.user_id)
         .where(BroadcastRecipient.broadcast_id == bid).order_by(BroadcastRecipient.id))
    if status:
        q = q.where(BroadcastRecipient.status == status)
    rows, total = await paginate(session, q, paging, scalars=False)
    return page_response([{"id": r.id, "status": r.status.value, "error": r.error, "sent_at": r.sent_at,
                           "customer": {"id": u.id, "display_name": u.display_name, "username": u.username}}
                          for r, u in rows], total, paging)


@router.put("/{bid}")
async def update(bid: int, body: BroadcastIn, session: DB, auth: Perm("broadcasts.send")) -> dict[str, Any]:
    b = await _get(session, bid)
    if b.status not in (BroadcastStatus.DRAFT, BroadcastStatus.SCHEDULED):
        raise Conflict("Only drafts and scheduled broadcasts can be edited")
    _apply(b, body)
    return out(b)


@router.delete("/{bid}")
async def delete(bid: int, session: DB, auth: Perm("broadcasts.send")) -> dict[str, str]:
    b = await _get(session, bid)
    if b.status == BroadcastStatus.SENDING:
        raise Conflict("Cancel the broadcast before deleting it")
    await session.delete(b)
    await audit(session, auth.admin, "broadcast.delete", f"Deleted broadcast “{b.name}”", entity_type="broadcast", entity_id=bid)
    return {"status": "ok"}


@router.post("/{bid}/test")
async def test_send(bid: int, session: DB, auth: Perm("broadcasts.send")) -> dict[str, str]:
    b = await _get(session, bid)
    if not auth.admin.telegram_id:
        raise ValidationFailed("Link your Telegram account (Profile → Security) to receive test messages")
    media = await session.get(Media, b.media_id) if b.media_id else None
    lang = (await settings_store.group("localization")).get("default_language", "en")
    try:
        await svc.send_one(b, media, auth.admin.telegram_id, lang, lang,
                           bool(await settings_store.get("bot.custom_emoji_in_messages", False)))
    except Exception as exc:
        raise ValidationFailed(f"Telegram rejected the message: {exc}") from exc
    return {"status": "sent"}


class ScheduleIn(BaseModel):
    scheduled_at: datetime | None = None  # None = send now


@router.post("/{bid}/send")
async def send(bid: int, body: ScheduleIn, session: DB, auth: Perm("broadcasts.send")) -> dict[str, Any]:
    await _feature()
    b = await _get(session, bid)
    if b.status not in (BroadcastStatus.DRAFT, BroadcastStatus.SCHEDULED):
        raise Conflict("This broadcast was already sent")
    if body.scheduled_at and body.scheduled_at <= utcnow():
        raise ValidationFailed("Scheduled time must be in the future")
    b.status = BroadcastStatus.SCHEDULED
    b.scheduled_at = body.scheduled_at or utcnow()
    b.total_count = await svc.count_audience(session, b.audience or {})
    await session.commit()
    if not body.scheduled_at:
        await enqueue("run_broadcast", b.id, _job_id=f"broadcast:{b.id}")
    await audit(session, auth.admin, "broadcast.send" if not body.scheduled_at else "broadcast.schedule",
                f"{'Started' if not body.scheduled_at else 'Scheduled'} broadcast “{b.name}” to {b.total_count} recipients",
                entity_type="broadcast", entity_id=b.id)
    return out(b)


@router.post("/{bid}/cancel")
async def cancel(bid: int, session: DB, auth: Perm("broadcasts.send")) -> dict[str, Any]:
    b = await _get(session, bid)
    if b.status not in (BroadcastStatus.SCHEDULED, BroadcastStatus.SENDING):
        raise Conflict("Broadcast is not active")
    b.status = BroadcastStatus.CANCELLED
    b.finished_at = utcnow()
    await audit(session, auth.admin, "broadcast.cancel", f"Cancelled broadcast “{b.name}”", entity_type="broadcast", entity_id=b.id)
    return out(b)
