"""Order history."""

from __future__ import annotations

from aiogram import Router
from aiogram.types import CallbackQuery

from app.bot import screens
from app.bot.callbacks import Ord
from app.bot.context import BotCtx
from app.bot.render import show

router = Router(name="orders")


@router.callback_query(Ord.filter())
async def orders(cb: CallbackQuery, callback_data: Ord, ctx: BotCtx) -> None:
    await cb.answer()
    if callback_data.id:
        await show(ctx, await screens.order_screen(ctx, callback_data.id, callback_data.page), cb)
    else:
        await show(ctx, await screens.orders_screen(ctx, callback_data.page), cb)
