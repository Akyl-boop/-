"""Telegram native payments: Telegram Stars (XTR) and card payments via Telegram Payments providers."""

from __future__ import annotations

import math
from decimal import Decimal

from app.models import Payment, User
from app.payments.base import ConfigField, PaymentContext, PaymentCreated, PaymentProvider, RefundResult


class TelegramStarsProvider(PaymentProvider):
    code = "telegram_stars"
    title = "Telegram Stars"
    description = "Native in-app payments with Telegram Stars (recommended by Telegram for digital goods)."
    supports_refund = True
    config_fields = [
        ConfigField("usd_per_star", "Price of one Star in store currency", "number", default=0.013,
                    help="Stars amount = ceil(order total / this value)."),
    ]

    def stars_for(self, amount: Decimal) -> int:
        rate = Decimal(str(self.public.get("usd_per_star") or "0.013"))
        return max(1, math.ceil(amount / rate))

    async def create_payment(self, ctx: PaymentContext) -> PaymentCreated:
        stars = self.stars_for(ctx.payment.amount)
        return PaymentCreated(kind="telegram_invoice", pay_amount=Decimal(stars), pay_currency="XTR",
                              expires_at=ctx.expires_at, extra={"stars": stars})

    async def refund_payment(self, payment: Payment, amount: Decimal, user: User) -> RefundResult:
        from app.bot.instance import get_bot

        charge_id = payment.external_id
        if not charge_id:
            return RefundResult(ok=False, message="No Telegram charge id")
        if amount < payment.amount:
            return RefundResult(ok=False, message="Telegram Stars supports full refunds only")
        await get_bot().refund_star_payment(user_id=user.telegram_id, telegram_payment_charge_id=charge_id)
        return RefundResult(ok=True, external_id=charge_id)


class TelegramCardProvider(PaymentProvider):
    code = "telegram_card"
    title = "Card (Telegram Payments)"
    description = "Bank cards through a Telegram Payments provider (Stripe, etc.) configured in @BotFather."
    config_fields = [
        ConfigField("provider_token", "Provider token", "password", secret=True, required=True,
                    help="@BotFather → Payments → choose provider → copy token."),
        ConfigField("currency", "Charge currency (ISO 4217)", "text", default="USD"),
        ConfigField("exchange_rate", "Store currency → charge currency rate", "number", default=1),
        ConfigField("need_email", "Ask for e-mail", "boolean", default=False),
    ]

    def minor_units(self, amount: Decimal) -> int:
        rate = Decimal(str(self.public.get("exchange_rate") or 1))
        return int((amount * rate * 100).to_integral_value())

    async def create_payment(self, ctx: PaymentContext) -> PaymentCreated:
        currency = (self.public.get("currency") or ctx.order.currency).upper()
        return PaymentCreated(kind="telegram_invoice", pay_amount=Decimal(self.minor_units(ctx.payment.amount)) / 100,
                              pay_currency=currency, expires_at=ctx.expires_at,
                              extra={"minor_units": self.minor_units(ctx.payment.amount)})
