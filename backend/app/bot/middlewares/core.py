"""Bot middlewares: DB session, user/context loading, throttling, bans, maintenance, required subscription."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Any

from aiogram import BaseMiddleware
from aiogram.enums import ChatMemberStatus
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Message,
    PreCheckoutQuery,
    TelegramObject,
)

from app.bot.callbacks import Nav
from app.bot.context import BotCtx
from app.core.cache import content_cache
from app.core.database import session_scope
from app.core.logging import get_logger
from app.core.redis import redis
from app.security.ratelimit import hit
from app.services.customers import get_or_register
from app.services.settings import settings_store
from app.services.texts import t

log = get_logger(__name__)


def _from_user(event: TelegramObject) -> Any:
    return getattr(event, "from_user", None)


async def _reply(event: TelegramObject, text: str, markup: InlineKeyboardMarkup | None = None) -> None:
    if isinstance(event, CallbackQuery):
        await event.answer()
        if event.message is not None and isinstance(event.message, Message):
            try:
                await event.message.edit_text(text, reply_markup=markup)
                return
            except Exception:
                pass
            await event.message.answer(text, reply_markup=markup)
    elif isinstance(event, Message):
        await event.answer(text, reply_markup=markup)


class ThrottleMiddleware(BaseMiddleware):
    """Per-user rate limiting (protects the bot and Telegram limits from button mashing)."""

    async def __call__(self, handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
                       event: TelegramObject, data: dict[str, Any]) -> Any:
        user = _from_user(event)
        if user is None or isinstance(event, PreCheckoutQuery):
            return await handler(event, data)
        ok_short, _ = await hit(f"bot:{user.id}:s", 6, 2)
        ok_long, _ = await hit(f"bot:{user.id}:m", 90, 60)
        if not (ok_short and ok_long):
            if isinstance(event, CallbackQuery):
                lang = (user.language_code or "en")[:2]
                await event.answer(await t("error.rate_limit", lang), show_alert=False)
            return None
        return await handler(event, data)


class ContextMiddleware(BaseMiddleware):
    """Opens a DB unit of work, registers/loads the customer and builds the BotCtx."""

    async def __call__(self, handler: Callable[[TelegramObject, dict[str, Any]], Awaitable[Any]],
                       event: TelegramObject, data: dict[str, Any]) -> Any:
        tg_user = _from_user(event)
        if tg_user is None or tg_user.is_bot:
            return await handler(event, data)
        chat = getattr(getattr(event, "message", None), "chat", None) or getattr(event, "chat", None)
        if chat is not None and getattr(chat, "type", "private") != "private":
            # The storefront works in private chats only (admin group notifications are outbound).
            return None
        start_param = None
        if isinstance(event, Message) and event.text and event.text.startswith("/start "):
            start_param = event.text.split(" ", 1)[1].strip()[:64]
        async with session_scope() as session:
            user, created = await get_or_register(
                session, telegram_id=tg_user.id, username=tg_user.username, first_name=tg_user.first_name,
                last_name=tg_user.last_name, language_code=tg_user.language_code,
                is_premium=bool(getattr(tg_user, "is_premium", False)), start_param=start_param,
            )
            cfg = await settings_store.all()
            ctx = BotCtx(session=session, user=user, lang=user.language, cfg=cfg, bot=data["bot"])
            data["ctx"] = ctx
            data["session"] = session
            data["is_new_user"] = created

            if user.is_banned:
                await _reply(event, await ctx.t("error.banned"))
                return None
            maint = cfg["maintenance"]
            if maint.get("enabled") and tg_user.id not in {int(x) for x in maint.get("bypass_telegram_ids") or [] if str(x).lstrip("-").isdigit()}:
                if not isinstance(event, PreCheckoutQuery):
                    from app.bot.content import banner
                    from app.bot.render import Screen, show

                    screen = Screen(await ctx.t("maintenance.text"), None, await banner("maintenance", ctx.lang))
                    if isinstance(event, CallbackQuery):
                        await event.answer()
                    await show(ctx, screen, event)  # type: ignore[arg-type]
                    return None
            if cfg["features"].get("required_subscription") and not isinstance(event, PreCheckoutQuery):
                missing = await missing_subscriptions(data["bot"], tg_user.id, cfg["subscription"].get("channels") or [])
                if missing:
                    lines = "\n".join(f"• <a href=\"{c.get('url') or ''}\">{c.get('title') or c.get('chat_id')}</a>" for c in missing)
                    kb = [[InlineKeyboardButton(text=c.get("title") or str(c.get("chat_id")), url=c["url"])]
                          for c in missing if c.get("url")]
                    kb.append([InlineKeyboardButton(text=await ctx.b("btn.check_subscription"),
                                                    callback_data=Nav(to="home").pack())])
                    from app.services.texts import SafeHtml

                    await _reply(event, await ctx.t("subscription.required", channels=SafeHtml(lines)),
                                 InlineKeyboardMarkup(inline_keyboard=kb))
                    return None
            return await handler(event, data)


async def missing_subscriptions(bot: Any, user_id: int, channels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    missing = []
    for ch in channels:
        chat_id = ch.get("chat_id")
        if not chat_id:
            continue
        cache_key = f"sub:{chat_id}:{user_id}"
        if await redis.get(cache_key):
            continue
        try:
            member = await bot.get_chat_member(chat_id, user_id)
            ok = member.status in (ChatMemberStatus.MEMBER, ChatMemberStatus.ADMINISTRATOR, ChatMemberStatus.CREATOR,
                                   ChatMemberStatus.RESTRICTED)
        except Exception as exc:  # bot not admin in channel → don't lock users out
            log.warning("subscription_check_failed", chat_id=chat_id, error=str(exc))
            ok = True
        if ok:
            await redis.set(cache_key, "1", ex=600)
        else:
            missing.append(ch)
    return missing


__all__ = ["ContextMiddleware", "ThrottleMiddleware", "content_cache"]
