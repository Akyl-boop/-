"""Support tickets: created in Telegram, answered from the dashboard."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import on_commit
from app.core.events import publish_admin_event
from app.core.utils import utcnow
from app.models import Admin, Ticket, TicketMessage, User
from app.models.enums import TicketStatus
from app.services.customers import add_event, customer_line
from app.services.notifications import notify
from app.services.settings import settings_store


async def _next_number(session: AsyncSession) -> str:
    seq = (await session.execute(text("SELECT nextval('ticket_number_seq')"))).scalar_one()
    prefix = (await settings_store.get("general.ticket_prefix", "T")) or "T"
    return f"{prefix}-{int(seq)}"


async def create_ticket(session: AsyncSession, user: User, *, subject: str, body: str,
                        attachments: list[dict[str, Any]] | None = None, order_id: int | None = None) -> Ticket:
    now = utcnow()
    ticket = Ticket(number=await _next_number(session), user_id=user.id, subject=subject[:200] or "Support request",
                    status=TicketStatus.WAITING_ADMIN, order_id=order_id, last_message_at=now, unread_by_admin=True)
    session.add(ticket)
    await session.flush()
    session.add(TicketMessage(ticket_id=ticket.id, sender="customer", body=body[:4000], attachments=attachments or []))
    await add_event(session, user.id, "ticket_created", f"Support ticket {ticket.number}: {subject[:80]}",
                    {"ticket_id": ticket.id})
    await notify(session, "new_ticket", f"New ticket {ticket.number}", f"{user.display_name}: {subject}",
                 link=f"/support/{ticket.id}",
                 telegram_vars={"ticket": ticket.number, "customer": customer_line(user), "subject": subject},
                 data={"ticket_id": ticket.id})
    tid = ticket.id
    on_commit(session, lambda: publish_admin_event("ticket.created", {"id": tid}))
    return ticket


async def add_customer_message(session: AsyncSession, ticket: Ticket, body: str,
                               attachments: list[dict[str, Any]] | None = None) -> TicketMessage:
    msg = TicketMessage(ticket_id=ticket.id, sender="customer", body=body[:4000], attachments=attachments or [])
    session.add(msg)
    ticket.status = TicketStatus.WAITING_ADMIN
    ticket.last_message_at = utcnow()
    ticket.unread_by_admin = True
    ticket.closed_at = None
    user = await session.get(User, ticket.user_id)
    await notify(session, "ticket_message", f"New message · {ticket.number}", body[:300] or "📎 attachment",
                 link=f"/support/{ticket.id}",
                 telegram_vars={"ticket": ticket.number, "customer": customer_line(user) if user else "",
                                "message": body[:500]})
    tid = ticket.id
    on_commit(session, lambda: publish_admin_event("ticket.message", {"id": tid}))
    return msg


async def admin_reply(session: AsyncSession, ticket: Ticket, admin: Admin, body: str,
                      attachments: list[dict[str, Any]] | None = None, *, close: bool = False) -> TicketMessage:
    msg = TicketMessage(ticket_id=ticket.id, sender="admin", admin_id=admin.id, body=body[:4000],
                        attachments=attachments or [], delivered=False)
    session.add(msg)
    await session.flush()
    ticket.status = TicketStatus.RESOLVED if close else TicketStatus.WAITING_CUSTOMER
    ticket.last_message_at = utcnow()
    ticket.unread_by_admin = False
    if ticket.assigned_admin_id is None:
        ticket.assigned_admin_id = admin.id
    user = await session.get(User, ticket.user_id)
    assert user is not None
    tg_id, lang, number, msg_id = user.telegram_id, user.language, ticket.number, msg.id
    ticket_id = ticket.id

    async def _deliver() -> None:
        from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

        from app.bot.callbacks import Sup
        from app.bot.notify import send_text
        from app.core.database import session_scope
        from app.services.texts import btn, t

        markup = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text=await btn("btn.reply", lang), callback_data=Sup(act="reply", id=ticket_id).pack()),
            InlineKeyboardButton(text=await btn("btn.my_tickets", lang), callback_data=Sup(act="view", id=ticket_id).pack()),
        ]])
        ok = await send_text(tg_id, await t("support.admin_reply", lang, ticket=number, message=body), markup)
        async with session_scope() as s:
            m = await s.get(TicketMessage, msg_id)
            if m is not None:
                m.delivered = ok
        await publish_admin_event("ticket.message", {"id": ticket_id})

    on_commit(session, _deliver)
    return msg


async def close_ticket(session: AsyncSession, ticket: Ticket, *, by_customer: bool = False) -> None:
    ticket.status = TicketStatus.CLOSED
    ticket.closed_at = utcnow()
    session.add(TicketMessage(ticket_id=ticket.id, sender="system",
                              body="Closed by customer" if by_customer else "Closed by support"))
    tid = ticket.id
    on_commit(session, lambda: publish_admin_event("ticket.updated", {"id": tid}))
