"""Shared aiogram Bot instance usable from API, workers and the bot process."""

from __future__ import annotations

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.client.telegram import TelegramAPIServer
from aiogram.enums import ParseMode

from app.core.config import settings

_bot: Bot | None = None


class BotNotConfigured(RuntimeError):
    pass


def get_bot() -> Bot:
    global _bot
    if _bot is None:
        token = settings.bot_token.get_secret_value()
        if not token:
            raise BotNotConfigured("BOT_TOKEN is not configured")
        session = None
        if settings.telegram_api_server:
            session = AiohttpSession(api=TelegramAPIServer.from_base(settings.telegram_api_server))
        _bot = Bot(
            token=token,
            session=session,
            default=DefaultBotProperties(parse_mode=ParseMode.HTML, link_preview_is_disabled=True),
        )
    return _bot


def bot_configured() -> bool:
    return bool(settings.bot_token.get_secret_value())


async def close_bot() -> None:
    global _bot
    if _bot is not None:
        await _bot.session.close()
        _bot = None
