"""In-dashboard notification center."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import and_, func, or_, select
from sqlalchemy.dialects.postgresql import insert

from app.api.deps import DB, Auth, AuthContext, Paging, page_response, paginate
from app.models import Notification, NotificationRead

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _visible(auth: AuthContext) -> Any:
    from app.security.permissions import ALL_CODES

    perms = ALL_CODES if auth.admin.is_owner else [p.code for p in auth.admin.role.permissions]
    return or_(Notification.permission.is_(None), Notification.permission.in_(perms))


@router.get("")
async def list_notifications(session: DB, auth: Auth, paging: Paging, unread: bool = False,
                             type: str | None = None) -> dict[str, Any]:  # noqa: A002
    read_sub = select(NotificationRead.notification_id).where(NotificationRead.admin_id == auth.admin.id)
    q = select(Notification, Notification.id.in_(read_sub).label("is_read")).where(_visible(auth)).order_by(Notification.created_at.desc())
    if unread:
        q = q.where(Notification.id.notin_(read_sub))
    if type:
        q = q.where(Notification.type.in_(type.split(",")))
    rows, total = await paginate(session, q, paging, scalars=False)
    resp = page_response([{"id": n.id, "type": n.type, "severity": n.severity, "title": n.title, "body": n.body,
                           "link": n.link, "data": n.data, "created_at": n.created_at, "read": bool(r)} for n, r in rows],
                         total, paging)
    resp["unread"] = await _unread(session, auth)
    return resp


async def _unread(session: Any, auth: AuthContext) -> int:
    read_sub = select(NotificationRead.notification_id).where(NotificationRead.admin_id == auth.admin.id)
    return int((await session.execute(select(func.count()).select_from(Notification)
                                      .where(_visible(auth), Notification.id.notin_(read_sub)))).scalar_one())


@router.get("/unread-count")
async def unread_count(session: DB, auth: Auth) -> dict[str, int]:
    return {"unread": await _unread(session, auth)}


class ReadIn(BaseModel):
    ids: list[int] | None = None  # None = all


@router.post("/read")
async def mark_read(body: ReadIn, session: DB, auth: Auth) -> dict[str, int]:
    q = select(Notification.id).where(_visible(auth))
    if body.ids is not None:
        q = q.where(Notification.id.in_(body.ids))
    else:
        read_sub = select(NotificationRead.notification_id).where(NotificationRead.admin_id == auth.admin.id)
        q = q.where(Notification.id.notin_(read_sub))
    ids = list((await session.execute(q)).scalars())
    if ids:
        await session.execute(insert(NotificationRead).values([{"notification_id": i, "admin_id": auth.admin.id} for i in ids])
                              .on_conflict_do_nothing())
    return {"marked": len(ids), "unread": max(0, await _unread(session, auth))}


__all__ = ["and_"]
