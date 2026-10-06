"""Manual payment (bank transfer, card-to-card, cash…) confirmed by an administrator."""

from __future__ import annotations

from app.payments.base import ConfigField, PaymentContext, PaymentCreated, PaymentProvider


class ManualProvider(PaymentProvider):
    code = "manual"
    title = "Manual / bank transfer"
    description = "Shows your payment instructions; an administrator confirms the payment in the dashboard."
    config_fields = [
        ConfigField("instructions", "Payment instructions", "i18n", required=True,
                    help="Shown to the customer. Telegram HTML supported."),
    ]

    async def create_payment(self, ctx: PaymentContext) -> PaymentCreated:
        return PaymentCreated(kind="manual", expires_at=ctx.expires_at)
