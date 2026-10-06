"""Outbound messages to customers triggered by back-office events (delivery, refunds, support replies…)."""

from __future__ import annotations

import io
from typing import Any

from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter
from aiogram.types import BufferedInputFile, InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.bot.callbacks import Nav, Ord, Rev, Sup
from app.bot.instance import bot_configured, get_bot
from app.bot.media import send_media
from app.core.database import SessionLocal, session_scope
from app.core.logging import get_logger
from app.core.utils import i18n_get
from app.models import Media, Order, Product, User
from app.security.html import escape, sanitize_telegram_html
from app.services.money import fmt
from app.services.settings import settings_store
from app.services.texts import SafeHtml, btn, cleanup_whitespace, t

log = get_logger(__name__)


async def _mark_blocked(telegram_id: int) -> None:
    async with session_scope() as s:
        await s.execute(update(User).where(User.telegram_id == telegram_id).values(bot_blocked=True))


async def send_text(telegram_id: int, text: str, markup: InlineKeyboardMarkup | None = None, **kwargs: Any) -> bool:
    if not bot_configured():
        return False
    try:
        await get_bot().send_message(telegram_id, text[:4096], reply_markup=markup, **kwargs)
        return True
    except TelegramForbiddenError:
        await _mark_blocked(telegram_id)
    except TelegramRetryAfter as exc:
        log.warning("telegram_retry_after", seconds=exc.retry_after)
    except TelegramBadRequest as exc:
        log.warning("send_text_failed", error=str(exc))
    return False


async def _order_keyboard(order: Order, lang: str, product_ids: list[int]) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton(text=await btn("btn.view_order", lang), callback_data=Ord(id=order.id).pack())]]
    if await settings_store.feature("reviews") and product_ids:
        rows.append([InlineKeyboardButton(text=await btn("btn.leave_review", lang),
                                          callback_data=Rev(order=order.id, product=product_ids[0]).pack())])
    if await settings_store.feature("support"):
        rows.append([InlineKeyboardButton(text=await btn("btn.order_support", lang),
                                          callback_data=Sup(act="ord", id=order.id).pack())])
    rows.append([InlineKeyboardButton(text=await btn("btn.home", lang), callback_data=Nav(to="home").pack())])
    return InlineKeyboardMarkup(inline_keyboard=rows)


async def send_order_delivery(order_id: int, item_ids: list[int]) -> None:
    """Send the 'order completed' message with the delivered goods for the given items."""
    from app.fulfillment.service import delivered_units

    if not bot_configured():
        return
    async with SessionLocal() as s:
        order = (
            await s.execute(select(Order).where(Order.id == order_id).options(selectinload(Order.items)))
        ).scalar_one_or_none()
        if order is None:
            return
        user = order.user
        lang = user.language
        products = {
            p.id: p for p in (await s.execute(
                select(Product).where(Product.id.in_([i.product_id for i in order.items if i.product_id] or [0]))
            )).scalars()
        }
        bot_cfg = await settings_store.group("bot")
        protect = bool(bot_cfg.get("protect_delivered_content"))
        markup = await _order_keyboard(order, lang, [i.product_id for i in order.items if i.product_id])
        method = order.payment_method or "—"
        bot = get_bot()
        for item in order.items:
            if item.id not in item_ids:
                continue
            units = delivered_units(item)
            text_units = [u for u in units if u.get("type") == "text" and u.get("value")]
            file_units = [u for u in units if u.get("type") == "file" and u.get("media_id")]
            product = products.get(item.product_id or 0)
            instructions = ""
            warranty = ""
            if product is not None:
                instr = i18n_get(product.delivery_instructions, lang)
                if instr:
                    instructions = await t("order.instructions", lang, instructions=SafeHtml(sanitize_telegram_html(instr)))
                w = i18n_get(product.warranty, lang)
                if w:
                    warranty = await t("product.warranty", lang, warranty=w)
            lines = [await t("order.delivery_line", lang, value=u["value"]) for u in text_units]
            delivery_block = "\n".join(lines)
            too_long = len(delivery_block) > 2500
            if too_long:
                delivery_block = f"📎 {len(text_units)} item(s) — see the attached file."
            if not text_units and file_units:
                delivery_block = "📎"
            text = await t(
                "order.completed", lang, order=order.number, product=item.product_name,
                variant=f" · {item.variant_name}" if item.variant_name else "", qty=item.quantity,
                total=await fmt(item.total, order.currency), method=method,
                date=(order.paid_at or order.created_at).strftime("%Y-%m-%d %H:%M UTC"),
                delivery=SafeHtml(delivery_block), instructions=SafeHtml(instructions), warranty=SafeHtml(warranty),
            )
            text = cleanup_whitespace(text)
            try:
                await bot.send_message(user.telegram_id, text[:4096], reply_markup=None if too_long or file_units else markup,
                                       protect_content=protect)
                if too_long:
                    content = "\n".join(u["value"] for u in text_units).encode()
                    await bot.send_document(
                        user.telegram_id, BufferedInputFile(content, filename=f"{order.number}-{item.id}.txt"),
                        caption=escape(item.product_name), reply_markup=None if file_units else markup,
                        protect_content=protect,
                    )
                for idx, fu in enumerate(file_units):
                    media = await s.get(Media, fu["media_id"])
                    if media is None:
                        continue
                    await send_media(bot, user.telegram_id, media, caption=escape(item.product_name),
                                     reply_markup=markup if idx == len(file_units) - 1 else None, protect_content=protect)
            except TelegramForbiddenError:
                await _mark_blocked(user.telegram_id)
                return
            except TelegramBadRequest as exc:
                log.error("delivery_message_failed", order=order.number, error=str(exc))
                # Fallback: plain text file so the customer always gets the goods
                content = io.BytesIO("\n".join(u["value"] for u in text_units).encode())
                try:
                    await bot.send_document(user.telegram_id,
                                            BufferedInputFile(content.getvalue(), filename=f"{order.number}.txt"),
                                            caption=f"Order {order.number}", reply_markup=markup)
                except Exception:
                    log.exception("delivery_fallback_failed", order=order.number)


async def send_order_waiting(order_id: int, failed: bool = False) -> None:
    async with SessionLocal() as s:
        order = await s.get(Order, order_id)
        if order is None:
            return
        user = order.user
        key = "order.delivery_failed" if failed else "order.paid_manual_delivery"
        markup = await _order_keyboard(order, user.language, [])
        await send_text(user.telegram_id, await t(key, user.language, order=order.number), markup)


async def send_payment_expired(order_id: int) -> None:
    async with SessionLocal() as s:
        order = await s.get(Order, order_id)
        if order is None:
            return
        user = order.user
        markup = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text=await btn("btn.support", user.language), callback_data=Sup(act="home").pack())],
            [InlineKeyboardButton(text=await btn("btn.home", user.language), callback_data=Nav(to="home").pack())],
        ])
        await send_text(user.telegram_id, await t("payment.expired", user.language, order=order.number), markup)
