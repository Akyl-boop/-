"""Fallback for free text (treated as search when enabled) and unknown callbacks."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.types import CallbackQuery, Message

from app.bot import screens
from app.bot.context import BotCtx
from app.bot.render import show

router = Router(name="fallback")


@router.message(F.text & ~F.text.startswith("/"))
async def free_text(message: Message, ctx: BotCtx) -> None:
    if ctx.feature("search") and len(message.text or "") >= 2:
        await show(ctx, await screens.search_results_screen(ctx, (message.text or "")[:64]), message)
    else:
        await show(ctx, await screens.home_screen(ctx), message)


@router.message()
async def any_message(message: Message, ctx: BotCtx) -> None:
    await show(ctx, await screens.home_screen(ctx), message)


@router.callback_query()
async def stale_callback(cb: CallbackQuery, ctx: BotCtx) -> None:
    await cb.answer(await ctx.t("error.session_expired"))
    await show(ctx, await screens.home_screen(ctx), cb)
