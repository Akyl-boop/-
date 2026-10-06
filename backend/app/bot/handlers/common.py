"""Navigation: /start, home, generic Nav targets, language, pages, FAQ, custom menu buttons."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from app.bot import screens
from app.bot.callbacks import Faq, Lang, MenuBtn, Nav, Pg
from app.bot.content import menu_button
from app.bot.context import BotCtx, Kb
from app.bot.render import Screen, show
from app.core.utils import i18n_get
from app.security.html import sanitize_telegram_html
from app.services.texts import text_store

router = Router(name="common")


@router.message(CommandStart())
async def cmd_start(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    await state.clear()
    arg = (message.text or "").split(" ", 1)[1].strip() if " " in (message.text or "") else ""
    if arg.startswith("p_") and arg[2:].isdigit():
        await show(ctx, await screens.product_screen(ctx, int(arg[2:])), message)
        return
    if arg.startswith("c_") and arg[2:].isdigit():
        await show(ctx, await screens.category_screen(ctx, int(arg[2:])), message)
        return
    await show(ctx, await screens.home_screen(ctx), message)
    if ctx.cfg["bot"].get("delete_user_inputs"):
        try:
            await message.delete()
        except Exception:
            pass


@router.message(Command("menu", "help", "home"))
async def cmd_menu(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    await state.clear()
    await show(ctx, await screens.home_screen(ctx), message)


@router.message(Command("catalog"))
async def cmd_catalog(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    await state.clear()
    await show(ctx, await screens.catalog_screen(ctx), message)


@router.message(Command("cart"))
async def cmd_cart(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    await state.clear()
    await show(ctx, await screens.cart_screen(ctx), message)


@router.message(Command("orders"))
async def cmd_orders(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    await state.clear()
    await show(ctx, await screens.orders_screen(ctx), message)


@router.message(Command("support"))
async def cmd_support(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    await state.clear()
    await show(ctx, await screens.support_screen(ctx), message)


@router.callback_query(Nav.filter(F.to == "noop"))
async def noop(cb: CallbackQuery) -> None:
    await cb.answer()


@router.callback_query(Nav.filter())
async def nav(cb: CallbackQuery, callback_data: Nav, ctx: BotCtx, state: FSMContext) -> None:
    await state.clear()
    to = callback_data.to
    builders = {
        "home": lambda: screens.home_screen(ctx),
        "catalog": lambda: screens.catalog_screen(ctx),
        "cart": lambda: screens.cart_screen(ctx),
        "orders": lambda: screens.orders_screen(ctx, callback_data.page),
        "unpaid": lambda: screens.orders_screen(ctx, callback_data.page, unpaid_only=True),
        "profile": lambda: screens.profile_screen(ctx),
        "fav": lambda: screens.favorites_screen(ctx),
        "recent": lambda: screens.recent_screen(ctx),
        "ref": lambda: screens.referrals_screen(ctx),
        "lang": lambda: screens.language_screen(ctx),
    }
    feature_guard = {"cart": "cart", "fav": "favorites", "recent": "recently_viewed", "ref": "referrals"}
    if to in feature_guard and not ctx.feature(feature_guard[to]):
        await cb.answer(await ctx.t("error.feature_disabled"), show_alert=True)
        return
    if to == "search":
        from app.bot.handlers.catalog import start_search

        await start_search(cb, ctx, state)
        return
    builder = builders.get(to, builders["home"])
    await cb.answer()
    await show(ctx, await builder(), cb)


@router.callback_query(Lang.filter())
async def set_language(cb: CallbackQuery, callback_data: Lang, ctx: BotCtx) -> None:
    codes = {lang["code"] for lang in await text_store.languages()}
    if callback_data.code in codes:
        ctx.user.language = callback_data.code
        ctx.lang = callback_data.code
    await cb.answer(await ctx.t("language.changed"))
    await show(ctx, await screens.home_screen(ctx), cb)


@router.callback_query(Faq.filter())
async def faq(cb: CallbackQuery, callback_data: Faq, ctx: BotCtx) -> None:
    await cb.answer()
    await show(ctx, await screens.faq_screen(ctx, callback_data.id), cb)


@router.callback_query(Pg.filter())
async def page(cb: CallbackQuery, callback_data: Pg, ctx: BotCtx) -> None:
    await cb.answer()
    await show(ctx, await screens.page_screen(ctx, callback_data.slug), cb)


@router.callback_query(MenuBtn.filter())
async def custom_button(cb: CallbackQuery, callback_data: MenuBtn, ctx: BotCtx) -> None:
    btn = await menu_button(callback_data.id)
    await cb.answer()
    if btn is None:
        await show(ctx, await screens.home_screen(ctx), cb)
        return
    text = sanitize_telegram_html(btn.get("value") or "") or i18n_get(btn["label"], ctx.lang)
    kb = Kb().row(*await screens.nav_row(ctx, None))
    await show(ctx, Screen(text, kb.markup()), cb)
