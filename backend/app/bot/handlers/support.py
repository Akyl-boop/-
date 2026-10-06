"""Support tickets inside Telegram."""

from __future__ import annotations

from aiogram import F, Router
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import CallbackQuery, Message

from app.bot import screens
from app.bot.callbacks import Sup
from app.bot.context import BotCtx, Kb
from app.bot.render import Screen, show
from app.models import Order, Ticket
from app.services import support as support_service

router = Router(name="support")


class SupportSt(StatesGroup):
    subject = State()
    message = State()
    reply = State()


def _attachments(message: Message) -> list[dict]:
    if message.photo:
        return [{"type": "photo", "file_id": message.photo[-1].file_id}]
    if message.document:
        return [{"type": "document", "file_id": message.document.file_id, "name": message.document.file_name}]
    if message.video:
        return [{"type": "video", "file_id": message.video.file_id}]
    return []


@router.callback_query(Sup.filter())
async def support_action(cb: CallbackQuery, callback_data: Sup, ctx: BotCtx, state: FSMContext) -> None:
    if not ctx.feature("support"):
        await cb.answer(await ctx.t("error.feature_disabled"), show_alert=True)
        return
    act = callback_data.act
    await cb.answer()
    if act == "home":
        await state.clear()
        await show(ctx, await screens.support_screen(ctx), cb)
    elif act in ("new", "ord"):
        order_id = None
        if act == "ord" and callback_data.id:
            order = await ctx.session.get(Order, callback_data.id)
            if order is not None and order.user_id == ctx.user.id:
                order_id = order.id
        await state.set_state(SupportSt.subject)
        await state.update_data(order_id=order_id)
        kb = Kb().row(ctx.button(await ctx.b("btn.cancel"), cb=Sup(act="home")))
        await show(ctx, Screen(await ctx.t("support.ask_subject"), kb.markup()), cb)
    elif act == "list":
        await state.clear()
        await show(ctx, await screens.tickets_screen(ctx, callback_data.page), cb)
    elif act == "view":
        await state.clear()
        await show(ctx, await screens.ticket_screen(ctx, callback_data.id), cb)
    elif act == "reply":
        ticket = await ctx.session.get(Ticket, callback_data.id)
        if ticket is None or ticket.user_id != ctx.user.id:
            return
        await state.set_state(SupportSt.reply)
        await state.update_data(ticket_id=ticket.id)
        kb = Kb().row(ctx.button(await ctx.b("btn.cancel"), cb=Sup(act="view", id=ticket.id)))
        await show(ctx, Screen(await ctx.t("support.reply_prompt", ticket=ticket.number), kb.markup()), cb)
    elif act == "close":
        ticket = await ctx.session.get(Ticket, callback_data.id)
        if ticket is not None and ticket.user_id == ctx.user.id:
            await support_service.close_ticket(ctx.session, ticket, by_customer=True)
            await show(ctx, Screen(await ctx.t("support.closed", ticket=ticket.number),
                                   Kb().row(*await screens.nav_row(ctx, Sup(act="list"))).markup()), cb)


@router.message(SupportSt.subject, F.text)
async def ticket_subject(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    await state.update_data(subject=(message.text or "").strip()[:200])
    await state.set_state(SupportSt.message)
    kb = Kb().row(ctx.button(await ctx.b("btn.cancel"), cb=Sup(act="home")))
    await message.answer(await ctx.t("support.ask_message"), reply_markup=kb.markup())


@router.message(SupportSt.message, F.text | F.photo | F.document | F.video)
async def ticket_message(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    data = await state.get_data()
    await state.clear()
    ticket = await support_service.create_ticket(
        ctx.session, ctx.user, subject=data.get("subject") or "Support request",
        body=(message.text or message.caption or "").strip(), attachments=_attachments(message),
        order_id=data.get("order_id"),
    )
    kb = Kb().row(ctx.button(await ctx.b("btn.my_tickets"), cb=Sup(act="view", id=ticket.id)))
    kb.row(*await screens.nav_row(ctx, None))
    await message.answer(await ctx.t("support.created", ticket=ticket.number), reply_markup=kb.markup())


@router.message(SupportSt.reply, F.text | F.photo | F.document | F.video)
async def ticket_reply(message: Message, ctx: BotCtx, state: FSMContext) -> None:
    data = await state.get_data()
    await state.clear()
    ticket = await ctx.session.get(Ticket, data.get("ticket_id"))
    if ticket is None or ticket.user_id != ctx.user.id:
        return
    await support_service.add_customer_message(ctx.session, ticket, (message.text or message.caption or "").strip(),
                                               _attachments(message))
    kb = Kb().row(ctx.button(await ctx.b("btn.my_tickets"), cb=Sup(act="view", id=ticket.id)))
    await message.answer(await ctx.t("support.message_sent"), reply_markup=kb.markup())
