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


# ─── Custom (animated) emoji helper ─────────────────────────────────────────


def _custom_emoji(message: Message) -> list[tuple[str, str]]:
    """(custom_emoji_id, fallback emoji) pairs found in a message or custom-emoji sticker."""
    found: list[tuple[str, str]] = []
    if message.sticker is not None and message.sticker.custom_emoji_id:
        found.append((message.sticker.custom_emoji_id, message.sticker.emoji or "⭐"))
    text = message.text or message.caption or ""
    for ent in message.entities or message.caption_entities or []:
        if ent.type == "custom_emoji" and ent.custom_emoji_id:
            found.append((ent.custom_emoji_id, ent.extract_from(text) or "⭐"))
    return list(dict.fromkeys(found))


async def _is_linked_admin(message: Message, ctx: BotCtx) -> bool:
    if message.from_user is None:
        return False
    row = await ctx.session.execute(select(Admin.id).where(Admin.telegram_id == message.from_user.id, Admin.is_active.is_(True)))
    return row.first() is not None


@router.message(Command("emojiid"), _is_linked_admin)
async def emoji_id_help(message: Message) -> None:
    await message.answer(
        "✨ <b>Custom emoji helper</b>\n\n"
        "Send me a message containing animated (custom) emoji, or a custom-emoji sticker. "
        "I'll reply with their IDs and check whether Telegram lets <b>this bot</b> send them.\n\n"
        "Paste the ID into the dashboard's emoji picker (Custom emoji ID).")


@router.message(_is_linked_admin, _custom_emoji)
async def emoji_ids(message: Message) -> None:
    items = _custom_emoji(message)[:10]
    lines = [f"{fb}  <code>{cid}</code>" for cid, fb in items]
    cid, fb = items[0]
    try:
        sent = await message.answer(f'<tg-emoji emoji-id="{cid}">{fb}</tg-emoji> ← delivery test')
        kept = any(e.type == "custom_emoji" for e in (sent.entities or []))
        verdict = (
            "✅ Telegram kept the custom emoji — this bot <b>can</b> send animated emoji. Enable "
            "<i>Bot Editor → Appearance → Custom emoji in messages</i>."
            if kept else
            "⛔ Telegram dropped the custom emoji, so users see the plain fallback. This bot is not allowed to send "
            "them: it needs an additional username purchased on Fragment (or the ID is invalid). "
            "Until then keep the switch off and use regular emoji or animated banners.")
    except Exception as exc:  # report the Telegram error to the admin
        verdict = f"⚠️ Telegram rejected the test message: {str(exc)[:200]}"
    await message.answer("<b>Custom emoji IDs</b>\n" + "\n".join(lines) + "\n\n" + verdict)
