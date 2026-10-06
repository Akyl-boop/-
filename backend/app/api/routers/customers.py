"""Customers & CRM."""

from __future__ import annotations

import csv
import io
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select

from app.api.deps import DB, Paging, Perm, page_response, paginate
from app.api.serializers import order_brief, payment_out, user_brief, user_out
from app.core.errors import Conflict, NotFound
from app.models import (
    Admin,
    BalanceTransaction,
    CustomerEvent,
    CustomerNote,
    CustomerTag,
    Order,
    Payment,
    Referral,
    User,
    user_tags,
)
from app.models.enums import BalanceTxType
from app.security.html import sanitize_telegram_html
from app.services.audit import audit
from app.services.customers import add_event, adjust_balance

router = APIRouter(tags=["customers"])


def _filters(query: Any, q: str | None, tag_id: int | None, banned: bool | None, language: str | None,
             has_orders: bool | None, min_spent: Decimal | None, max_spent: Decimal | None,
             joined_from: date | None, joined_to: date | None) -> Any:
    if q:
        term = q.strip().lstrip("@")
        conds = [User.username.ilike(f"%{term}%"), User.first_name.ilike(f"%{term}%"), User.last_name.ilike(f"%{term}%"),
                 User.referral_code == term.upper()]
        if term.isdigit():
            conds += [User.telegram_id == int(term), User.id == int(term)]
        query = query.where(or_(*conds))
    if tag_id:
        query = query.where(User.id.in_(select(user_tags.c.user_id).where(user_tags.c.tag_id == tag_id)))
    if banned is not None:
        query = query.where(User.is_banned.is_(banned))
    if language:
        query = query.where(User.language == language)
    if has_orders is not None:
        query = query.where(User.paid_orders_count > 0 if has_orders else User.paid_orders_count == 0)
    if min_spent is not None:
        query = query.where(User.total_spent >= min_spent)
    if max_spent is not None:
        query = query.where(User.total_spent <= max_spent)
    if joined_from:
        query = query.where(User.created_at >= datetime.combine(joined_from, time.min))
    if joined_to:
        query = query.where(User.created_at <= datetime.combine(joined_to, time.max))
    return query


@router.get("/customers")
async def list_customers(session: DB, auth: Perm("customers.view"), paging: Paging, q: str | None = None,
                         tag_id: int | None = None, banned: bool | None = None, language: str | None = None,
                         has_orders: bool | None = None, min_spent: Decimal | None = None,
                         max_spent: Decimal | None = None, joined_from: date | None = None, joined_to: date | None = None,
                         sort: str = "-created_at") -> dict[str, Any]:
    query = _filters(select(User), q, tag_id, banned, language, has_orders, min_spent, max_spent, joined_from, joined_to)
    col = {"created_at": User.created_at, "total_spent": User.total_spent, "orders": User.paid_orders_count,
           "last_activity_at": User.last_activity_at}.get(sort.lstrip("-"), User.created_at)
    query = query.order_by(col.desc().nulls_last() if sort.startswith("-") else col.asc())
    items, total = await paginate(session, query, paging)
    return page_response([user_out(u) for u in items], total, paging)


@router.get("/customers/export")
async def export_customers(session: DB, auth: Perm("customers.view"), q: str | None = None, tag_id: int | None = None,
                           banned: bool | None = None, language: str | None = None) -> StreamingResponse:
    query = _filters(select(User), q, tag_id, banned, language, None, None, None, None, None).order_by(User.id)
    rows = (await session.execute(query.limit(100000))).scalars().all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "telegram_id", "username", "first_name", "last_name", "language", "joined", "last_activity",
                "orders", "total_spent", "balance", "banned", "tags"])
    for u in rows:
        w.writerow([u.id, u.telegram_id, u.username or "", u.first_name or "", u.last_name or "", u.language,
                    u.created_at.isoformat(), u.last_activity_at.isoformat() if u.last_activity_at else "",
                    u.paid_orders_count, u.total_spent, u.balance, u.is_banned, ";".join(t.name for t in u.tags)])
    await audit(session, auth.admin, "customers.export", f"Exported {len(rows)} customers")
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="customers.csv"'})


async def _user(session: Any, user_id: int) -> User:
    u = await session.get(User, user_id)
    if u is None:
        raise NotFound("Customer not found")
    return u


@router.get("/customers/{user_id}")
async def get_customer(user_id: int, session: DB, auth: Perm("customers.view")) -> dict[str, Any]:
    u = await _user(session, user_id)
    stats = (await session.execute(select(
        func.count(Order.id),
        func.count(Order.id).filter(Order.status.in_(["completed", "paid", "processing"])),
        func.count(Order.id).filter(Order.status.in_(["cancelled", "expired"])),
        func.count(Order.id).filter(Order.status.in_(["refunded", "partially_refunded"])),
        func.coalesce(func.sum(Order.refunded_amount), 0),
    ).where(Order.user_id == u.id))).one()
    notes = (await session.execute(select(CustomerNote).where(CustomerNote.user_id == u.id)
                                   .order_by(CustomerNote.created_at.desc()))).scalars().all()
    events = (await session.execute(select(CustomerEvent).where(CustomerEvent.user_id == u.id)
                                    .order_by(CustomerEvent.created_at.desc()).limit(100))).scalars().all()
    admin_ids = {n.admin_id for n in notes} | {e.admin_id for e in events}
    admins = {a.id: a.name for a in (await session.execute(select(Admin).where(Admin.id.in_([i for i in admin_ids if i] or [0])))).scalars()}
    referrer = await session.get(User, u.referred_by_id) if u.referred_by_id else None
    ref_stats = (await session.execute(select(func.count(Referral.id), func.count(Referral.converted_at),
                                              func.coalesce(func.sum(Referral.reward_total), 0))
                                       .where(Referral.referrer_id == u.id))).one()
    return {
        **user_out(u),
        "stats": {"orders": int(stats[0]), "successful": int(stats[1]), "cancelled": int(stats[2]), "refunds": int(stats[3]),
                  "refunded_amount": stats[4]},
        "notes": [{"id": n.id, "body": n.body, "admin": admins.get(n.admin_id), "created_at": n.created_at} for n in notes],
        "timeline": [{"id": e.id, "type": e.type, "message": e.message, "data": e.data, "admin": admins.get(e.admin_id),
                      "created_at": e.created_at} for e in events],
        "referrer": user_brief(referrer) if referrer else None,
        "referrals": {"invited": int(ref_stats[0]), "converted": int(ref_stats[1]), "earned": ref_stats[2]},
    }


@router.get("/customers/{user_id}/orders")
async def customer_orders(user_id: int, session: DB, auth: Perm("orders.view"), paging: Paging) -> dict[str, Any]:
    items, total = await paginate(session, select(Order).where(Order.user_id == user_id).order_by(Order.created_at.desc()), paging)
    return page_response([order_brief(o) for o in items], total, paging)


@router.get("/customers/{user_id}/payments")
async def customer_payments(user_id: int, session: DB, auth: Perm("payments.view"), paging: Paging) -> dict[str, Any]:
    q = select(Payment).join(Order, Order.id == Payment.order_id).where(Order.user_id == user_id).order_by(Payment.created_at.desc())
    items, total = await paginate(session, q, paging)
    return page_response([payment_out(p) for p in items], total, paging)


@router.get("/customers/{user_id}/balance")
async def customer_balance(user_id: int, session: DB, auth: Perm("customers.view"), paging: Paging) -> dict[str, Any]:
    q = select(BalanceTransaction).where(BalanceTransaction.user_id == user_id).order_by(BalanceTransaction.created_at.desc())
    items, total = await paginate(session, q, paging)
    return page_response([{"id": t.id, "amount": t.amount, "balance_after": t.balance_after, "type": t.type.value,
                           "order_id": t.order_id, "note": t.note, "created_at": t.created_at} for t in items], total, paging)


class BanIn(BaseModel):
    banned: bool
    reason: str | None = Field(None, max_length=255)


@router.post("/customers/{user_id}/ban")
async def ban(user_id: int, body: BanIn, session: DB, auth: Perm("customers.ban")) -> dict[str, Any]:
    u = await _user(session, user_id)
    u.is_banned = body.banned
    u.ban_reason = body.reason if body.banned else None
    action = "banned" if body.banned else "unbanned"
    await add_event(session, u.id, action, f"Customer {action}" + (f": {body.reason}" if body.reason else ""), admin_id=auth.admin.id)
    await audit(session, auth.admin, ("customer.ban" if body.banned else "customer.unban"),
                f"{action.capitalize()} {u.display_name}", entity_type="customer", entity_id=u.id,
                new={"reason": body.reason})
    return user_out(u)


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


@router.post("/customers/{user_id}/notes", status_code=201)
async def add_note(user_id: int, body: NoteIn, session: DB, auth: Perm("customers.edit")) -> dict[str, Any]:
    u = await _user(session, user_id)
    note = CustomerNote(user_id=u.id, admin_id=auth.admin.id, body=body.body)
    session.add(note)
    await add_event(session, u.id, "note", "Admin note added", admin_id=auth.admin.id)
    await session.flush()
    return {"id": note.id, "body": note.body, "admin": auth.admin.name, "created_at": note.created_at}


@router.delete("/customers/{user_id}/notes/{note_id}")
async def delete_note(user_id: int, note_id: int, session: DB, auth: Perm("customers.edit")) -> dict[str, str]:
    await session.execute(delete(CustomerNote).where(CustomerNote.id == note_id, CustomerNote.user_id == user_id))
    return {"status": "ok"}


class TagsIn(BaseModel):
    tag_ids: list[int] = Field(max_length=50)


@router.put("/customers/{user_id}/tags")
async def set_tags(user_id: int, body: TagsIn, session: DB, auth: Perm("customers.edit")) -> dict[str, Any]:
    u = await _user(session, user_id)
    tags = (await session.execute(select(CustomerTag).where(CustomerTag.id.in_(body.tag_ids or [0])))).scalars().all()
    u.tags = list(tags)
    await add_event(session, u.id, "tags", "Tags updated: " + (", ".join(t.name for t in tags) or "none"), admin_id=auth.admin.id)
    return user_out(u)


class MessageIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/customers/{user_id}/message")
async def send_message(user_id: int, body: MessageIn, session: DB, auth: Perm("customers.edit")) -> dict[str, Any]:
    from app.bot.notify import send_text

    u = await _user(session, user_id)
    ok = await send_text(u.telegram_id, sanitize_telegram_html(body.text))
    await add_event(session, u.id, "message", "Message sent by admin" if ok else "Message delivery failed",
                    {"text": body.text[:500]}, admin_id=auth.admin.id)
    await audit(session, auth.admin, "customer.message", f"Sent message to {u.display_name}", entity_type="customer", entity_id=u.id)
    return {"status": "ok" if ok else "failed"}


class BalanceIn(BaseModel):
    amount: Decimal = Field(description="Positive to credit, negative to debit")
    note: str = Field(min_length=1, max_length=255)
    notify: bool = True


@router.post("/customers/{user_id}/balance")
async def change_balance(user_id: int, body: BalanceIn, session: DB, auth: Perm("customers.balance")) -> dict[str, Any]:
    if body.amount == 0:
        raise Conflict("Amount must not be zero")
    u = await _user(session, user_id)
    old = u.balance
    new = await adjust_balance(session, u.id, body.amount, BalanceTxType.ADJUSTMENT, admin_id=auth.admin.id, note=body.note)
    await add_event(session, u.id, "balance", f"Balance adjusted by {body.amount}: {body.note}", admin_id=auth.admin.id)
    await audit(session, auth.admin, "customer.balance", f"Adjusted balance of {u.display_name} by {body.amount}",
                entity_type="customer", entity_id=u.id, old={"balance": old}, new={"balance": new, "note": body.note})
    if body.notify:
        from app.bot.notify import send_text
        from app.core.database import on_commit
        from app.services.money import fmt
        from app.services.texts import t

        tg, lang, amount = u.telegram_id, u.language, body.amount

        async def _tell() -> None:
            sign = "+" if amount > 0 else "−"
            await send_text(tg, await t("notify.balance_adjusted", lang, amount=f"{sign}{await fmt(abs(amount))}",
                                        balance=await fmt(new)))

        on_commit(session, _tell)
    return {"balance": new}


# ─── Tags ───────────────────────────────────────────────────────────────────


class TagIn(BaseModel):
    name: str = Field(min_length=1, max_length=48)
    color: str = Field("#8b5cf6", pattern=r"^#[0-9a-fA-F]{6}$")
    description: str | None = Field(None, max_length=255)


@router.get("/tags")
async def list_tags(session: DB, auth: Perm("customers.view")) -> list[dict[str, Any]]:
    counts = dict((await session.execute(select(user_tags.c.tag_id, func.count()).group_by(user_tags.c.tag_id))).all())
    tags = (await session.execute(select(CustomerTag).order_by(CustomerTag.name))).scalars().all()
    return [{"id": t.id, "name": t.name, "color": t.color, "description": t.description, "customers": counts.get(t.id, 0)}
            for t in tags]


@router.post("/tags", status_code=201)
async def create_tag(body: TagIn, session: DB, auth: Perm("customers.edit")) -> dict[str, Any]:
    if (await session.execute(select(CustomerTag).where(func.lower(CustomerTag.name) == body.name.lower()))).first():
        raise Conflict("Tag already exists")
    t = CustomerTag(**body.model_dump())
    session.add(t)
    await session.flush()
    return {"id": t.id, **body.model_dump(), "customers": 0}


@router.put("/tags/{tag_id}")
async def update_tag(tag_id: int, body: TagIn, session: DB, auth: Perm("customers.edit")) -> dict[str, Any]:
    t = await session.get(CustomerTag, tag_id)
    if t is None:
        raise NotFound("Tag not found")
    t.name, t.color, t.description = body.name, body.color, body.description
    return {"id": t.id, **body.model_dump()}


@router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: int, session: DB, auth: Perm("customers.edit")) -> dict[str, str]:
    t = await session.get(CustomerTag, tag_id)
    if t:
        await session.delete(t)
    return {"status": "ok"}
