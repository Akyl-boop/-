"""Cart management and promo codes."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from app.bot import screens
from app.bot.callbacks import CartAct, Nav
from app.bot.context import BotCtx, Kb
from app.bot.render import Screen, show
from app.core.errors import AppError, PromoError
from app.services import cart as cart_service

router = Router(name="cart")


class PromoSt(StatesGroup):
    code = State()


async def _error_text(ctx: BotCtx, exc: AppError) -> str:
    if "." in exc.code:
        details = exc.details if isinstance(exc.details, dict) else {}
        return await ctx.t(exc.code, **details)
    return exc.message


@router.callback_query(CartAct.filter())
async def cart_action(cb: CallbackQuery, callback_data: CartAct, ctx: BotCtx, state: FSMContext) -> None:
    act = callback_data.act
    if not ctx.feature("cart"):
        await cb.answer(await ctx.t("error.feature_disabled"), show_alert=True)
        return
    try:
        if act in ("inc", "dec"):
            cart = await cart_service.get_cart(ctx.session, ctx.user.id)
            item = next((i for i in cart.items if i.id == callback_data.item), None) if cart else None
            if item is not None:
                await cart_service.set_quantity(ctx.session, ctx.user, item.id, item.quantity + (1 if act == "inc" else -1))
            await cb.answer()
        elif act == "del":
            await cart_service.set_quantity(ctx.session, ctx.user, callback_data.item, 0)
            await cb.answer()
        elif act == "clr":
            await cb.answer()
            await show(ctx, await screens.confirm_screen(ctx, await ctx.t("cart.clear_confirm"), CartAct(act="clr_ok"),
                                                         Nav(to="cart")), cb)
            return
        elif act == "clr_ok":
            await cart_service.clear(ctx.session, ctx.user.id)
            await cb.answer(await ctx.t("cart.cleared"))
        elif act == "promo":
            await cb.answer()
            await state.set_state(PromoSt.code)
            kb = Kb().row(ctx.button(await ctx.b("btn.cancel"), cb=Nav(to="cart")))
            from app.bot.content import banner

            msg = await show(ctx, Screen(await ctx.t("cart.promo_prompt"), kb.markup(), await banner("promotions", ctx.lang)), cb)
            if msg:
                await state.update_data(prompt_id=msg.message_id)
            return
        elif act == "unpromo":
            await cart_service.remove_promo(ctx.session, ctx.user)
            await cb.answer()
        elif act == "bal":
            cart = await cart_service.get_cart(ctx.session, ctx.user.id)
            if cart is not None:
                cart.use_balance = not cart.use_balance
            await cb.answer()
        elif act == "co":
            await cb.answer()
            from app.bot.handlers.checkout import checkout_cart

            await checkout_cart(cb, ctx)
            return
    except AppError as exc:
        await cb.answer(await _error_text(ctx, exc), show_alert=True)
    await show(ctx, await screens.cart_screen(ctx), cb)


@router.message(PromoSt.code, F.text)
async def promo_code_entered(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    data = await state.get_data()
    await state.clear()
    code = (message.text or "").strip()[:48]
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
    notice = None
    try:
        summary = await cart_service.apply_promo(ctx.session, ctx.user, code)
        notice = await ctx.t("cart.promo_applied", code=summary.promo_code or code.upper(), amount=ctx.money(summary.discount))
    except PromoError as exc:
        details = exc.details if isinstance(exc.details, dict) else {}
        if "amount" in details:
            details = {"amount": ctx.money(details["amount"])}
        notice = await ctx.t("cart.promo_invalid", reason=await ctx.t(exc.code, **details))
    await show(ctx, await screens.cart_screen(ctx, notice=notice), message)
