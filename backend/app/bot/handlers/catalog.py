"""Catalog, product pages, favorites, restock alerts, search."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message
from sqlalchemy import delete

from app.bot import screens
from app.bot.callbacks import Cat, Nav, Prod, ProdAct
from app.bot.context import BotCtx, Kb
from app.bot.render import Screen, show
from app.core.errors import AppError
from app.models import Favorite, RestockSubscription
from app.services import cart as cart_service

router = Router(name="catalog")


class SearchSt(StatesGroup):
    query = State()


@router.callback_query(Cat.filter())
async def category(cb: CallbackQuery, callback_data: Cat, ctx: BotCtx) -> None:
    await cb.answer()
    await show(ctx, await screens.category_screen(ctx, callback_data.id, callback_data.page), cb)


@router.callback_query(Prod.filter())
async def product(cb: CallbackQuery, callback_data: Prod, ctx: BotCtx) -> None:
    await cb.answer()
    await show(ctx, await screens.product_screen(ctx, callback_data.id, callback_data.sel, callback_data.qty,
                                                 callback_data.back), cb)


@router.callback_query(ProdAct.filter())
async def product_action(cb: CallbackQuery, callback_data: ProdAct, ctx: BotCtx, state: FSMContext) -> None:
    act = callback_data.act
    if act == "add":
        if not ctx.feature("cart"):
            await cb.answer(await ctx.t("error.feature_disabled"), show_alert=True)
            return
        try:
            await cart_service.add_item(ctx.session, ctx.user, callback_data.vid, callback_data.qty)
        except AppError as exc:
            await cb.answer(await ctx.t(exc.code) if "." in exc.code else exc.message, show_alert=True)
            return
        await cb.answer(await ctx.t("product.added"))
        await _keep_variant_and_show(cb, ctx, callback_data)
    elif act == "buy":
        from app.bot.handlers.checkout import checkout_lines
        from app.services.orders import LineRequest

        await cb.answer()
        await checkout_lines(cb, ctx, [LineRequest(variant_id=callback_data.vid, quantity=callback_data.qty)])
    elif act == "fav":
        existing = await ctx.session.get(Favorite, (ctx.user.id, callback_data.pid))
        if existing:
            await ctx.session.delete(existing)
            await cb.answer(await ctx.t("product.favorite_removed"))
        else:
            ctx.session.add(Favorite(user_id=ctx.user.id, product_id=callback_data.pid))
            await cb.answer(await ctx.t("product.favorite_added"))
        await ctx.session.flush()
        await _keep_variant_and_show(cb, ctx, callback_data)
    elif act == "rst":
        existing = await ctx.session.get(RestockSubscription, (ctx.user.id, callback_data.pid))
        if existing:
            await ctx.session.execute(delete(RestockSubscription).where(
                RestockSubscription.user_id == ctx.user.id, RestockSubscription.product_id == callback_data.pid))
            await cb.answer()
        else:
            ctx.session.add(RestockSubscription(user_id=ctx.user.id, product_id=callback_data.pid))
            await cb.answer(await ctx.t("product.restock_subscribed"), show_alert=True)
        await ctx.session.flush()
        await _keep_variant_and_show(cb, ctx, callback_data)
    elif act == "rev":
        await cb.answer()
        await show(ctx, await screens.reviews_screen(ctx, callback_data.pid), cb)
    else:
        await cb.answer()


def _current_prod_state(cb: CallbackQuery, pid: int) -> tuple[str, int, str]:
    """Recover (sel, qty, back) of the product screen from the current keyboard."""
    sel, qty, back = "", 1, ""
    markup = getattr(cb.message, "reply_markup", None)
    if not markup:
        return sel, qty, back
    for row in markup.inline_keyboard:
        for b in row:
            data = b.callback_data or ""
            if data.startswith("p:"):
                try:
                    p = Prod.unpack(data)
                except Exception:
                    continue
                if p.id != pid:
                    continue
                back = p.back or back
                if b.text == "−":
                    sel = p.sel
            elif data.startswith("pa:add:") or data.startswith("pa:buy:"):
                try:
                    pa = ProdAct.unpack(data)
                    qty = pa.qty
                except Exception:
                    pass
    return sel, qty, back


async def _keep_variant_and_show(cb: CallbackQuery, ctx: BotCtx, data: ProdAct) -> None:
    sel, qty, back = _current_prod_state(cb, data.pid)
    if not sel and data.vid:
        # find selection path leading to this variant
        from app.services.catalog import get_storefront_product

        product = await get_storefront_product(ctx.session, data.pid, ctx.lang)
        if product is not None:
            sel = _selection_for_variant(product, data.vid, ctx.lang)
    await show(ctx, await screens.product_screen(ctx, data.pid, sel, qty, back, count_view=False), cb)


def _selection_for_variant(product, variant_id: int, lang: str) -> str:  # type: ignore[no-untyped-def]
    active = [v for v in product.variants if v.is_active]
    if len(active) <= 1:
        return ""
    target = next((v for v in active if v.id == variant_id), None)
    if target is None:
        return ""
    groups = [g for g in (product.option_groups or []) if g.get("key")] or [{"key": "__v"}]
    chosen: list[int] = []
    candidates = active
    for g in groups:
        values = list(dict.fromkeys(screens._variant_value(v, g["key"], lang) for v in candidates))
        val = screens._variant_value(target, g["key"], lang)
        if val not in values:
            break
        chosen.append(values.index(val))
        candidates = [v for v in candidates if screens._variant_value(v, g["key"], lang) == val]
    return ".".join(str(c) for c in chosen)


# ─── Search ─────────────────────────────────────────────────────────────────


async def start_search(cb: CallbackQuery, ctx: BotCtx, state: FSMContext) -> None:
    if not ctx.feature("search"):
        await cb.answer(await ctx.t("error.feature_disabled"), show_alert=True)
        return
    await cb.answer()
    await state.set_state(SearchSt.query)
    kb = Kb().row(*await screens.nav_row(ctx, Nav(to="catalog")))
    msg = await show(ctx, Screen(await ctx.t("search.prompt"), kb.markup()), cb)
    if msg:
        await state.update_data(prompt_id=msg.message_id)


@router.message(SearchSt.query, F.text)
async def search_query(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    query = (message.text or "").strip()[:64]
    data = await state.get_data()
    await state.clear()
    if ctx.cfg["bot"].get("delete_user_inputs"):
        try:
            await message.delete()
        except Exception:
            pass
    if data.get("prompt_id"):
        try:
            await ctx.bot.delete_message(message.chat.id, data["prompt_id"])
        except Exception:
            pass
    await show(ctx, await screens.search_results_screen(ctx, query), message)
