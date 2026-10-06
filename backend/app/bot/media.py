"""Sending media from the Media Library with Telegram file_id caching."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from aiogram import Bot
from aiogram.types import FSInputFile, InputFile, Message
from sqlalchemy import update

from app.core.config import settings
from app.core.database import session_scope
from app.models import Media


def media_path(media: Media) -> Path:
    return Path(settings.media_root) / media.storage_key


def media_input(media: Media, bot: Bot) -> str | InputFile:
    if media.telegram_file_id and media.telegram_bot_id == bot.id:
        return media.telegram_file_id
    return FSInputFile(media_path(media), filename=media.original_name)


def extract_file_id(message: Message) -> str | None:
    if message.photo:
        return message.photo[-1].file_id
    for attr in ("animation", "video", "sticker", "document", "audio"):
        obj = getattr(message, attr, None)
        if obj is not None:
            return obj.file_id
    return None


async def remember_file_id(media_id: uuid.UUID, message: Message, bot: Bot) -> None:
    file_id = extract_file_id(message)
    if not file_id:
        return
    async with session_scope() as s:
        await s.execute(update(Media).where(Media.id == media_id).values(telegram_file_id=file_id, telegram_bot_id=bot.id))


async def send_media(bot: Bot, chat_id: int, media: Media, caption: str | None = None, **kwargs: Any) -> Message:
    file = media_input(media, bot)
    kind = media.kind
    if kind == "image" and media.mime_type != "image/gif":
        msg = await bot.send_photo(chat_id, file, caption=caption, **kwargs)
    elif kind == "animation" or media.mime_type == "image/gif":
        msg = await bot.send_animation(chat_id, file, caption=caption, **kwargs)
    elif kind == "video":
        msg = await bot.send_video(chat_id, file, caption=caption, **kwargs)
    elif kind == "sticker":
        kwargs.pop("parse_mode", None)
        msg = await bot.send_sticker(chat_id, file, reply_markup=kwargs.get("reply_markup"))
    else:
        msg = await bot.send_document(chat_id, file, caption=caption, **kwargs)
    if not isinstance(file, str):
        await remember_file_id(media.id, msg, bot)
    return msg
