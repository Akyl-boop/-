"""Admin-side bot interactions: linking a Telegram account and approving dashboard sign-ins."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command, CommandObject
from aiogram.types import CallbackQuery, Message
from sqlalchemy import select

from app.bot.context import BotCtx
from app.models import Admin
from app.services.audit import audit
from app.services.auth import consume_telegram_link_code, get_challenge, set_telegram_decision

router = Router(name="admin")


@router.message(Command("link"))
async def link_account(message: Message, command: CommandObject, ctx: BotCtx) -> None:
    code = (command.args or "").strip()
    admin_id = await consume_telegram_link_code(code) if code else None
    if admin_id is None:
        await message.answer("⚠️ Invalid or expired link code. Generate a new one in Dashboard → Profile → Security.")
        return
    admin = await ctx.session.get(Admin, admin_id)
    if admin is None:
        return
    other = (await ctx.session.execute(select(Admin).where(Admin.telegram_id == message.from_user.id))).scalar_one_or_none()  # type: ignore[union-attr]
    if other is not None and other.id != admin.id:
        other.telegram_id = None
    admin.telegram_id = message.from_user.id  # type: ignore[union-attr]
    await audit(ctx.session, admin, "admin.telegram_linked", "Linked Telegram account", entity_type="admin",
                entity_id=admin.id)
    await message.answer(f"✅ Telegram linked to <b>{admin.email}</b>. You'll receive admin notifications here.")


@router.callback_query(F.data.startswith("adm:"))
async def login_decision(cb: CallbackQuery, ctx: BotCtx) -> None:
    _, decision, cid = (cb.data or "::").split(":", 2)
    try:
        challenge = await get_challenge(cid)
    except Exception:
        await cb.answer("This sign-in request has expired.", show_alert=True)
        return
    admin = await ctx.session.get(Admin, challenge["admin_id"])
    if admin is None or admin.telegram_id != cb.from_user.id:
        await cb.answer("Not allowed", show_alert=True)
        return
    approved = decision == "ok"
    await set_telegram_decision(cid, approved)
    await cb.answer("Approved" if approved else "Denied")
    if cb.message is not None:
        try:
            await cb.message.edit_text(  # type: ignore[union-attr]
                (cb.message.html_text or "") + ("\n\n✅ <b>Approved</b>" if approved else "\n\n✕ <b>Denied</b>"))  # type: ignore[union-attr]
        except Exception:
            pass
