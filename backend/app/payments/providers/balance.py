"""Internal store balance."""

from __future__ import annotations

from app.payments.base import PaymentContext, PaymentCreated, PaymentProvider


class BalanceProvider(PaymentProvider):
    code = "balance"
    title = "Store balance"
    description = "Pay with the customer's internal balance (refunds, referral rewards)."
    config_fields = []

    async def create_payment(self, ctx: PaymentContext) -> PaymentCreated:
        return PaymentCreated(kind="instant")
