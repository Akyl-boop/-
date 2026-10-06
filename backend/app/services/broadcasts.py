"""Broadcast campaigns: audience targeting, rate-limited delivery with retries."""

from __future__ import annotations

import asyncio
from datetime import datetime
from decimal import Decimal
from typing import Any

from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import Select, func, insert, literal, select, update

from app.bot.callbacks import Cat, Nav, Prod
from app.core.database import SessionLocal, session_scope
from app.core.events import publish_admin_event
from app.core.logging import get_logger
from app.core.utils import i18n_get, utcnow
from app.models import Broadcast, BroadcastRecipient, CustomerTag, Media, Order, OrderItem, User, user_tags
from app.models.enums import PAID_ORDER_STATUSES, BroadcastStatus, RecipientStatus
from app.security.html import sanitize_telegram_html, strip_custom_emoji

log = get_logger(__name__)
RATE_PER_SECOND = 25  # Telegram: ~30 messages/second for bots
BATCH = 200


def audience_query(a: dict[str, Any]) -> Select:
    q = select(User.id).where(User.is_banned.is_(False), User.bot_blocked.is_(False))
    kind = a.get("type", "all")
    if kind == "customers":
        q = q.where(User.paid_orders_count > 0)
    elif kind == "non_customers":
        q = q.where(User.paid_orders_count == 0)
    elif kind == "product_buyers" and a.get("product_ids"):
        buyers = (select(Order.user_id).join(OrderItem, OrderItem.order_id == Order.id)
                  .where(OrderItem.product_id.in_(a["product_ids"]), Order.status.in_(PAID_ORDER_STATUSES)))
        q = q.where(User.id.in_(buyers))
    elif kind == "vip":
        vip = select(user_tags.c.user_id).join(CustomerTag, CustomerTag.id == user_tags.c.tag_id).where(
            func.lower(CustomerTag.name) == "vip")
        q = q.where(User.id.in_(vip))
    elif kind == "tag" and a.get("tag_ids"):
        q = q.where(User.id.in_(select(user_tags.c.user_id).where(user_tags.c.tag_id.in_(a["tag_ids"]))))
    elif kind == "users" and a.get("user_ids"):
        q = q.where(User.id.in_(a["user_ids"]))
    if a.get("languages"):
        q = q.where(User.language.in_(a["languages"]))
    if a.get("registered_from"):
        q = q.where(User.created_at >= datetime.fromisoformat(a["registered_from"]))
    if a.get("registered_to"):
        q = q.where(User.created_at <= datetime.fromisoformat(a["registered_to"]))
    if a.get("min_spent") not in (None, ""):
        q = q.where(User.total_spent >= Decimal(str(a["min_spent"])))
    if a.get("max_spent") not in (None, ""):
        q = q.where(User.total_spent <= Decimal(str(a["max_spent"])))
    return q


async def count_audience(session: Any, audience: dict[str, Any]) -> int:
    return int((await session.execute(select(func.count()).select_from(audience_query(audience).subquery()))).scalar_one())


def build_markup(buttons: list[dict[str, Any]], lang: str) -> InlineKeyboardMarkup | None:
    rows = []
    for b in buttons or []:
        label = i18n_get(b.get("label"), lang)
        if not label:
            continue
        if b.get("emoji"):
            label = f"{b['emoji']} {label}"
        action, value = b.get("action", "url"), str(b.get("value") or "")
        btn: InlineKeyboardButton | None = None
        if action == "url" and value.startswith(("https://", "http://", "tg://")):
            btn = InlineKeyboardButton(text=label[:64], url=value)
        elif action == "product" and value.isdigit():
            btn = InlineKeyboardButton(text=label[:64], callback_data=Prod(id=int(value)).pack())
        elif action == "category" and value.isdigit():
            btn = InlineKeyboardButton(text=label[:64], callback_data=Cat(id=int(value)).pack())
        elif action in ("catalog", "home", "cart", "profile"):
            btn = InlineKeyboardButton(text=label[:64], callback_data=Nav(to=action).pack())
        if btn:
            rows.append([btn])
    return InlineKeyboardMarkup(inline_keyboard=rows) if rows else None


async def send_one(bc: Broadcast, media: Media | None, user_tg: int, lang: str, default_lang: str,
                   custom_emoji: bool) -> int:
    from app.bot.instance import get_bot
    from app.bot.media import send_media

    text = sanitize_telegram_html(bc.text.get(lang) or bc.text.get(default_lang) or next(iter(bc.text.values()), ""))
    if not custom_emoji:
        text = strip_custom_emoji(text)
    markup = build_markup(bc.buttons, lang)
    bot = get_bot()
    kwargs = {"disable_notification": bc.disable_notification, "protect_content": bc.protect_content}
    if media is not None:
        if len(text) <= 1024 and media.kind != "sticker":
            msg = await send_media(bot, user_tg, media, caption=text or None, reply_markup=markup, **kwargs)
            return msg.message_id
        await send_media(bot, user_tg, media, **kwargs)
    msg = await bot.send_message(user_tg, text[:4096] or "·", reply_markup=markup, **kwargs)
    return msg.message_id


async def prepare_recipients(session: Any, bc: Broadcast) -> int:
    sub = audience_query(bc.audience or {}).subquery()
    await session.execute(
        insert(BroadcastRecipient).from_select(["broadcast_id", "user_id"], select(literal(bc.id), sub.c.id))
    )
    total = (await session.execute(select(func.count()).select_from(BroadcastRecipient)
                                   .where(BroadcastRecipient.broadcast_id == bc.id))).scalar_one()
    bc.total_count = int(total)
    return int(total)


async def run_broadcast(broadcast_id: int) -> None:
    """Worker entry point. Safe to resume: only PENDING recipients are processed."""
    from app.services.settings import settings_store

    async with session_scope() as s:
        bc = (await s.execute(select(Broadcast).where(Broadcast.id == broadcast_id).with_for_update())).scalar_one_or_none()
        if bc is None or bc.status not in (BroadcastStatus.SCHEDULED, BroadcastStatus.SENDING):
            return
        if bc.status == BroadcastStatus.SCHEDULED:
            bc.status = BroadcastStatus.SENDING
            bc.started_at = utcnow()
            await prepare_recipients(s, bc)
    default_lang = (await settings_store.group("localization")).get("default_language", "en")
    custom_emoji = bool(await settings_store.get("bot.custom_emoji_in_messages", False))
    interval = 1.0 / RATE_PER_SECOND
    while True:
        async with SessionLocal() as s:
            bc = await s.get(Broadcast, broadcast_id)
            if bc is None or bc.status != BroadcastStatus.SENDING:
                return
            media = await s.get(Media, bc.media_id) if bc.media_id else None
            batch = (await s.execute(
                select(BroadcastRecipient.id, User.telegram_id, User.language, User.id)
                .join(User, User.id == BroadcastRecipient.user_id)
                .where(BroadcastRecipient.broadcast_id == broadcast_id, BroadcastRecipient.status == RecipientStatus.PENDING)
                .order_by(BroadcastRecipient.id).limit(BATCH)
            )).all()
        if not batch:
            break
        sent = failed = blocked = 0
        for rid, tg_id, lang, uid in batch:
            status, error, message_id = RecipientStatus.SENT, None, None
            for attempt in range(3):
                try:
                    message_id = await send_one(bc, media, tg_id, lang, default_lang, custom_emoji)
                    break
                except TelegramRetryAfter as exc:
                    await asyncio.sleep(exc.retry_after + 0.5)
                except TelegramForbiddenError:
                    status, error = RecipientStatus.BLOCKED, "bot blocked by user"
                    break
                except TelegramBadRequest as exc:
                    status, error = RecipientStatus.FAILED, str(exc)[:255]
                    break
                except Exception as exc:  # network error → retry
                    status, error = RecipientStatus.FAILED, str(exc)[:255]
                    await asyncio.sleep(1 + attempt)
            async with session_scope() as s:
                await s.execute(update(BroadcastRecipient).where(BroadcastRecipient.id == rid).values(
                    status=status, error=error, message_id=message_id, sent_at=utcnow(),
                    attempts=BroadcastRecipient.attempts + 1))
                if status == RecipientStatus.BLOCKED:
                    await s.execute(update(User).where(User.id == uid).values(bot_blocked=True))
            sent += status == RecipientStatus.SENT
            failed += status == RecipientStatus.FAILED
            blocked += status == RecipientStatus.BLOCKED
            await asyncio.sleep(interval)
        async with session_scope() as s:
            await s.execute(update(Broadcast).where(Broadcast.id == broadcast_id).values(
                sent_count=Broadcast.sent_count + sent, failed_count=Broadcast.failed_count + failed + blocked,
                blocked_count=Broadcast.blocked_count + blocked))
            bc_now = await s.get(Broadcast, broadcast_id)
            progress = {"id": broadcast_id, "sent": bc_now.sent_count, "failed": bc_now.failed_count,
                        "total": bc_now.total_count, "status": bc_now.status.value}
        await publish_admin_event("broadcast.progress", progress)
    async with session_scope() as s:
        bc = await s.get(Broadcast, broadcast_id)
        if bc is not None and bc.status == BroadcastStatus.SENDING:
            bc.status = BroadcastStatus.COMPLETED
            bc.finished_at = utcnow()
    await publish_admin_event("broadcast.progress", {"id": broadcast_id, "status": "completed"})
    log.info("broadcast_completed", broadcast_id=broadcast_id)
