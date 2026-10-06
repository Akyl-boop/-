"""Dispatcher factory and bot lifecycle (polling and webhook modes)."""

from __future__ import annotations

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.redis import RedisStorage
from aiogram.types import BotCommand, ErrorEvent

from app.bot.handlers import admin, cart, catalog, checkout, common, fallback, orders, reviews, support
from app.bot.middlewares.core import ContextMiddleware, ThrottleMiddleware
from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)
_dispatcher: Dispatcher | None = None


def build_dispatcher() -> Dispatcher:
    global _dispatcher
    if _dispatcher is not None:
        return _dispatcher
    storage = RedisStorage.from_url(settings.redis_url, state_ttl=3600, data_ttl=3600)
    dp = Dispatcher(storage=storage)
    for observer in (dp.message, dp.callback_query, dp.pre_checkout_query):
        observer.outer_middleware(ThrottleMiddleware())
        observer.outer_middleware(ContextMiddleware())
    # Order matters: specific routers first, fallback last.
    dp.include_routers(admin.router, common.router, catalog.router, cart.router, checkout.router, orders.router, support.router,
                       reviews.router, fallback.router)

    @dp.errors()
    async def on_error(event: ErrorEvent) -> bool:
        log.exception("bot_handler_error", error=str(event.exception), exc_info=event.exception)
        update = event.update
        try:
            from app.services.texts import t

            lang = "en"
            if update.callback_query:
                lang = (update.callback_query.from_user.language_code or "en")[:2]
                await update.callback_query.answer(await t("error.generic", lang), show_alert=True)
            elif update.message:
                lang = (update.message.from_user.language_code or "en")[:2] if update.message.from_user else "en"
                await update.message.answer(await t("error.generic", lang))
        except Exception:
            pass
        try:
            from app.core.database import session_scope
            from app.services.notifications import notify

            async with session_scope() as s:
                await notify(s, "error", "Bot error", str(event.exception)[:500], link="/system",
                             telegram_vars={"details": f"{type(event.exception).__name__}: {str(event.exception)[:300]}"},
                             dedupe_key=type(event.exception).__name__, dedupe_ttl=600)
        except Exception:
            pass
        return True

    _dispatcher = dp
    return dp


async def set_commands(bot: Bot) -> None:
    from app.services.texts import btn

    for lang in ("en", "ru", "zh"):
        commands = [
            BotCommand(command="start", description=(await btn("btn.home", lang)).lstrip("🏠 ")),
            BotCommand(command="catalog", description=(await btn("btn.catalog", lang)).lstrip("🛍 ")),
            BotCommand(command="cart", description=(await btn("btn.cart", lang)).lstrip("🛒 ")),
            BotCommand(command="orders", description=(await btn("btn.orders", lang)).lstrip("📦 ")),
            BotCommand(command="support", description=(await btn("btn.support", lang)).lstrip("💬 ")),
        ]
        try:
            await bot.set_my_commands(commands, language_code=None if lang == "en" else lang)
        except Exception as exc:
            log.warning("set_commands_failed", error=str(exc))


ALLOWED_UPDATES = ["message", "callback_query", "pre_checkout_query"]
