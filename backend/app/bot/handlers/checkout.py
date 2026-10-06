"""Checkout, payment method selection, payment status checks and Telegram native payments."""

from __future__ import annotations

import io

import qrcode
from aiogram import F, Router
from aiogram.types import BufferedInputFile, CallbackQuery, LabeledPrice, Message, PreCheckoutQuery
from sqlalchemy import select

from app.bot import screens
from app.bot.callbacks import Nav, Pay
from app.bot.context import BotCtx, Kb
from app.bot.render import Screen, show
from app.core.errors import AppError
from app.core.redis import LockNotAcquired, redis_lock
from app.models import Order, Payment, PaymentMethod
from app.models.enums import OPEN_ORDER_STATUSES, OrderStatus, PaymentStatus
from app.payments import service as payments
from app.payments.base import ProviderUnavailable
from app.payments.registry import build_provider
from app.services import cart as cart_service
from app.services.orders import LineRequest, cancel_order, create_order, get_order_full

router = Router(name="checkout")


async def _err(ctx: BotCtx, exc: AppError) -> str:
    if "." in exc.code:
        details = exc.details if isinstance(exc.details, dict) else {}
        return await ctx.t(exc.code, **details)
    return await ctx.t("error.generic")


async def checkout_lines(cb: CallbackQuery, ctx: BotCtx, lines: list[LineRequest], *, promo_code_id: int | None = None,
                         use_balance: bool = False, clear_cart: bool = False) -> None:
    try:
        async with redis_lock(f"checkout:{ctx.user.id}", ttl=20):
            # Savepoint: a failed checkout (e.g. out of stock) rolls back only the partial order.
            async with ctx.session.begin_nested():
                order = await create_order(ctx.session, ctx.user, lines, promo_code_id=promo_code_id,
                                           use_balance=use_balance)
                if clear_cart:
                    await cart_service.clear(ctx.session, ctx.user.id)
            order = await get_order_full(ctx.session, order.id)
            assert order is not None
            if order.total <= 0:
                # Fully covered by discount / balance → confirm immediately
                payment = Payment(reference=payments.new_reference(), order_id=order.id, method_code="balance",
                                  provider="balance", status=PaymentStatus.PENDING, amount=order.total,
                                  currency=order.currency, extra={"kind": "instant"})
                ctx.session.add(payment)
                await ctx.session.flush()
                await payments.confirm_paid(ctx.session, payment.id, source="balance")
                kb = Kb().row(*await screens.nav_row(ctx, None))
                await show(ctx, Screen(await ctx.t("checkout.paid_by_balance") + "\n\n" +
                                       await ctx.t("status.order.paid"), kb.markup()), cb)
                return
    except LockNotAcquired:
        await cb.answer(await ctx.t("common.loading"))
        return
    except AppError as exc:
        await ctx.session.refresh(ctx.user)
        await show(ctx, await screens.cart_screen(ctx, notice="⚠️ " + await _err(ctx, exc)) if clear_cart else
                   Screen(await _err(ctx, exc), Kb().row(*await screens.nav_row(ctx, Nav(to="catalog"))).markup()), cb)
        return
    methods = await payments.available_methods(ctx.session, order, ctx.user)
    if len(methods) == 1:
        await _start_method(cb, ctx, order.id, methods[0].code)
        return
    await show(ctx, await screens.checkout_screen(ctx, order), cb)


async def checkout_cart(cb: CallbackQuery, ctx: BotCtx) -> None:
    summary = await cart_service.summarize(ctx.session, ctx.user)
    if not summary.lines:
        await show(ctx, await screens.cart_screen(ctx), cb)
        return
    cart = await cart_service.get_cart(ctx.session, ctx.user.id)
    lines = [LineRequest(variant_id=line.variant.id, quantity=line.quantity) for line in summary.lines]
    await checkout_lines(cb, ctx, lines, promo_code_id=cart.promo_code_id if cart else None,
                         use_balance=bool(cart and cart.use_balance), clear_cart=True)


async def _load_order(ctx: BotCtx, order_id: int) -> Order | None:
    order = (await ctx.session.execute(
        select(Order).where(Order.id == order_id, Order.user_id == ctx.user.id)
    )).scalar_one_or_none()
    if order is None:
        return None
    return await get_order_full(ctx.session, order.id)


async def _start_method(cb: CallbackQuery, ctx: BotCtx, order_id: int, method_code: str) -> None:
    try:
        payment = await payments.start_payment(ctx.session, order_id, method_code)
    except AppError as exc:
        order = await _load_order(ctx, order_id)
        if order is None or order.status not in OPEN_ORDER_STATUSES:
            await show(ctx, await screens.order_screen(ctx, order_id), cb)
            return
        await show(ctx, await screens.checkout_screen(ctx, order, notice="⚠️ " + await _err(ctx, exc)), cb)
        return
    order = await _load_order(ctx, order_id)
    assert order is not None
    if order.status == OrderStatus.PAID or payment.status == PaymentStatus.PAID:
        await show(ctx, await screens.order_screen(ctx, order.id), cb)
        return
    if (payment.extra or {}).get("kind") == "telegram_invoice":
        await _send_invoice(cb, ctx, order, payment)
    screen = await screens.payment_screen(ctx, order, payment)
    msg = await show(ctx, screen, cb)
    if msg:
        order.bot_message_id = msg.message_id


async def _send_invoice(cb: CallbackQuery, ctx: BotCtx, order: Order, payment: Payment) -> None:
    method = (await ctx.session.execute(select(PaymentMethod).where(PaymentMethod.code == payment.method_code))).scalar_one()
    provider = build_provider(method)
    items = ", ".join(f"{i.product_name} × {i.quantity}" for i in order.items)[:255]
    title = (await ctx.b("payment.invoice_title", order=order.number))[:32]
    if method.provider == "telegram_stars":
        stars = int(payment.extra.get("stars"))
        await ctx.bot.send_invoice(chat_id=ctx.user.telegram_id, title=title, description=items or title,
                                   payload=payment.reference, currency="XTR",
                                   prices=[LabeledPrice(label=order.number, amount=stars)])
    else:
        minor = int(payment.extra.get("minor_units"))
        await ctx.bot.send_invoice(chat_id=ctx.user.telegram_id, title=title, description=items or title,
                                   payload=payment.reference, currency=payment.pay_currency or "USD",
                                   provider_token=provider.secret.get("provider_token"),
                                   prices=[LabeledPrice(label=order.number, amount=minor)],
                                   need_email=bool(provider.public.get("need_email")))


@router.callback_query(Pay.filter())
async def pay_action(cb: CallbackQuery, callback_data: Pay, ctx: BotCtx) -> None:
    order = await _load_order(ctx, callback_data.order)
    if order is None:
        await cb.answer(await ctx.t("error.not_found"), show_alert=True)
        return
    act = callback_data.act
    if act == "m":
        await cb.answer()
        await _start_method(cb, ctx, order.id, callback_data.m)
        return
    if act == "chg":
        await cb.answer()
        if order.status not in (OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT):
            await show(ctx, await screens.order_screen(ctx, order.id), cb)
            return
        await show(ctx, await screens.checkout_screen(ctx, order), cb)
        return
    if act == "cnl":
        await cb.answer()
        await show(ctx, await screens.confirm_screen(ctx, await ctx.t("payment.cancel_confirm", order=order.number),
                                                     Pay(act="cnl_ok", order=order.id), Pay(act="chk", order=order.id)), cb)
        return
    if act == "cnl_ok":
        if order.status in (OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT):
            await cancel_order(ctx.session, order, reason="Cancelled by customer", actor="customer")
            await cb.answer(await ctx.t("payment.cancelled", order=order.number))
        else:
            await cb.answer()
        await show(ctx, await screens.order_screen(ctx, order.id), cb)
        return
    payment = next((p for p in reversed(order.payments)
                    if p.status in (PaymentStatus.PENDING, PaymentStatus.AWAITING_CONFIRMATION)), None)
    if act == "paid":
        await payments.customer_reports_paid(ctx.session, order.id)
        await cb.answer()
        order = await _load_order(ctx, order.id)
        assert order is not None
        payment = order.payments[-1] if order.payments else None
        if payment:
            await show(ctx, await screens.payment_screen(ctx, order, payment), cb)
        return
    if act == "qr" and payment is not None and payment.address:
        await cb.answer()
        uri = payment.address
        img = qrcode.make(uri, box_size=8, border=2)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        await ctx.bot.send_photo(ctx.user.telegram_id, BufferedInputFile(buf.getvalue(), filename="pay.png"),
                                 caption=f"<code>{payment.address}</code>")
        return
    if act == "chk":
        if payment is None:
            await cb.answer()
            await show(ctx, await screens.order_screen(ctx, order.id), cb)
            return
        notice = None
        try:
            async with redis_lock(f"paycheck:{payment.id}", ttl=15):
                payment = await payments.refresh_payment(ctx.session, payment.id)
        except LockNotAcquired:
            pass
        except ProviderUnavailable:
            notice = await ctx.t("payment.provider_unavailable")
        await ctx.session.flush()
        order = await _load_order(ctx, order.id)
        assert order is not None
        if order.status not in OPEN_ORDER_STATUSES:
            await cb.answer(await ctx.t(f"status.order.{order.status.value}"))
            await show(ctx, await screens.order_screen(ctx, order.id), cb)
            return
        current = next((p for p in reversed(order.payments) if p.id == payment.id), payment)
        if current.status == PaymentStatus.PENDING and notice is None:
            await cb.answer(await ctx.t("payment.not_found_yet"), show_alert=True)
        else:
            await cb.answer()
        await show(ctx, await screens.payment_screen(ctx, order, current, notice=notice), cb)
        return
    await cb.answer()


@router.pre_checkout_query()
async def pre_checkout(query: PreCheckoutQuery, ctx: BotCtx) -> None:
    error = await payments.validate_telegram_invoice(ctx.session, query.invoice_payload, query.currency,
                                                     query.total_amount)
    if error:
        await query.answer(ok=False, error_message=error)
    else:
        await query.answer(ok=True)


@router.message(F.successful_payment)
async def successful_payment(message: Message, ctx: BotCtx) -> None:
    sp = message.successful_payment
    assert sp is not None
    await payments.telegram_payment_succeeded(ctx.session, sp.invoice_payload, sp.telegram_payment_charge_id,
                                              sp.provider_payment_charge_id, sp.total_amount)
    await message.answer(await ctx.t("status.order.paid"))
