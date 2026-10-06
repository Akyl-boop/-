"""Product reviews after a completed order."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message
from sqlalchemy import select

from app.bot import screens
from app.bot.callbacks import Rev
from app.bot.context import BotCtx, Kb
from app.bot.render import Screen, show
from app.core.utils import i18n_get
from app.models import Order, OrderItem, Product, Review
from app.models.enums import OrderStatus

router = Router(name="reviews")


class ReviewSt(StatesGroup):
    text = State()


@router.callback_query(Rev.filter())
async def review(cb: CallbackQuery, callback_data: Rev, ctx: BotCtx, state: FSMContext) -> None:
    if not ctx.feature("reviews"):
        await cb.answer(await ctx.t("error.feature_disabled"), show_alert=True)
        return
    order = await ctx.session.get(Order, callback_data.order)
    item = (await ctx.session.execute(select(OrderItem).where(
        OrderItem.order_id == callback_data.order, OrderItem.product_id == callback_data.product))).scalars().first()
    if order is None or order.user_id != ctx.user.id or order.status != OrderStatus.COMPLETED or item is None:
        await cb.answer(await ctx.t("error.not_found"), show_alert=True)
        return
    await cb.answer()
    product = await ctx.session.get(Product, callback_data.product)
    if callback_data.rating == 0:
        kb = Kb().row(*[ctx.button("⭐" * r if r <= 1 else f"{r}⭐", cb=Rev(order=order.id, product=callback_data.product, rating=r))
                        for r in range(1, 6)])
        kb.row(*await screens.nav_row(ctx, None))
        name = i18n_get(product.name, ctx.lang) if product else item.product_name
        await show(ctx, Screen(await ctx.t("review.ask_rating", product=name), kb.markup()), cb)
        return
    existing = (await ctx.session.execute(select(Review).where(
        Review.user_id == ctx.user.id, Review.order_id == order.id, Review.product_id == callback_data.product))).scalar_one_or_none()
    rating = max(1, min(5, callback_data.rating))
    if existing:
        existing.rating = rating
        review_id = existing.id
    else:
        rv = Review(user_id=ctx.user.id, order_id=order.id, product_id=callback_data.product, rating=rating)
        ctx.session.add(rv)
        await ctx.session.flush()
        review_id = rv.id
    await state.set_state(ReviewSt.text)
    await state.update_data(review_id=review_id)
    kb = Kb().row(ctx.button(await ctx.b("review.skip"), cb=Rev(order=order.id, product=callback_data.product, rating=-1)))
    if callback_data.rating == -1:
        await state.clear()
        await show(ctx, Screen(await ctx.t("review.thanks"), Kb().row(*await screens.nav_row(ctx, None)).markup()), cb)
        return
    await show(ctx, Screen(await ctx.t("review.ask_text"), kb.markup()), cb)


@router.message(ReviewSt.text, F.text)
async def review_text(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    data = await state.get_data()
    await state.clear()
    rv = await ctx.session.get(Review, data.get("review_id"))
    if rv is not None and rv.user_id == ctx.user.id:
        rv.text = (message.text or "").strip()[:1000]
    await message.answer(await ctx.t("review.thanks"), reply_markup=Kb().row(*await screens.nav_row(ctx, None)).markup())
