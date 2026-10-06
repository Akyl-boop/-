"""Screen rendering: edit the current message whenever possible instead of spamming new ones."""

from __future__ import annotations

from dataclasses import dataclass

from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardMarkup,
    InputMediaAnimation,
    InputMediaDocument,
    InputMediaPhoto,
    InputMediaVideo,
    Message,
)

from app.bot.context import BotCtx
from app.bot.media import media_input, remember_file_id, send_media
from app.core.logging import get_logger
from app.models import Media

log = get_logger(__name__)
CAPTION_LIMIT = 1024
TEXT_LIMIT = 4096


@dataclass
class Screen:
    text: str
    keyboard: InlineKeyboardMarkup | None = None
    media: Media | None = None


def _has_media(msg: Message) -> bool:
    return bool(msg.photo or msg.animation or msg.video or msg.document or msg.sticker)


def _current_file_id(msg: Message) -> str | None:
    if msg.photo:
        return msg.photo[-1].file_id
    for attr in ("animation", "video", "document"):
        obj = getattr(msg, attr, None)
        if obj is not None:
            return obj.file_id
    return None


def _input_media(media: Media, file, caption: str):  # type: ignore[no-untyped-def]
    if media.kind == "video":
        return InputMediaVideo(media=file, caption=caption)
    if media.kind == "animation" or media.mime_type == "image/gif":
        return InputMediaAnimation(media=file, caption=caption)
    if media.kind == "document":
        return InputMediaDocument(media=file, caption=caption)
    return InputMediaPhoto(media=file, caption=caption)


def _truncate(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


async def show(ctx: BotCtx, screen: Screen, event: Message | CallbackQuery, *, force_new: bool = False) -> Message | None:
    """Render a screen. For callbacks the existing message is edited (or replaced if the media type changed)."""
    media = screen.media
    if media is not None and (media.kind == "sticker" or len(screen.text) > CAPTION_LIMIT):
        media = None  # stickers can't carry captions; long texts don't fit a caption
    text = _truncate(screen.text or "·", TEXT_LIMIT)
    chat_id = event.message.chat.id if isinstance(event, CallbackQuery) and event.message else event.chat.id  # type: ignore[union-attr]
    msg = event.message if isinstance(event, CallbackQuery) else None
    bot = ctx.bot

    if msg is not None and isinstance(msg, Message) and not force_new:
        try:
            if media is not None and _has_media(msg) and not msg.sticker:
                file = media_input(media, bot)
                if isinstance(file, str) and file == _current_file_id(msg):
                    res = await msg.edit_caption(caption=text, reply_markup=screen.keyboard)
                    return res if isinstance(res, Message) else msg
                edited = await msg.edit_media(media=_input_media(media, file, text), reply_markup=screen.keyboard)
                if not isinstance(file, str) and isinstance(edited, Message):
                    await remember_file_id(media.id, edited, bot)
                return edited if isinstance(edited, Message) else msg
            if media is None and not _has_media(msg):
                res = await msg.edit_text(text, reply_markup=screen.keyboard)
                return res if isinstance(res, Message) else msg
        except TelegramBadRequest as exc:
            if "message is not modified" in str(exc):
                return msg
            log.info("edit_failed_fallback_to_send", error=str(exc))
        # media type changed (or edit impossible): replace the message
        try:
            await msg.delete()
        except TelegramBadRequest:
            pass

    try:
        if media is not None:
            return await send_media(bot, chat_id, media, caption=text, reply_markup=screen.keyboard)
        return await bot.send_message(chat_id, text, reply_markup=screen.keyboard)
    except TelegramForbiddenError:
        return None
    except TelegramBadRequest as exc:
        log.warning("send_failed", error=str(exc))
        if media is not None:  # e.g. broken file → retry as text
            return await bot.send_message(chat_id, text, reply_markup=screen.keyboard)
        raise
