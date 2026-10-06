"""Crypto Pay API (@CryptoBot) provider — https://help.crypt.bot/crypto-pay-api"""

from __future__ import annotations

import hashlib
import hmac
from datetime import datetime
from decimal import Decimal
from typing import Any

import httpx
import orjson

from app.core.logging import get_logger
from app.core.utils import utcnow
from app.models import Payment, PaymentMethod, User
from app.models.enums import PaymentStatus
from app.payments.base import (
    ConfigField,
    PaymentContext,
    PaymentCreated,
    PaymentProvider,
    ProviderResult,
    ProviderUnavailable,
    RefundResult,
    WebhookResult,
)

log = get_logger(__name__)

MAINNET = "https://pay.crypt.bot/api"
TESTNET = "https://testnet-pay.crypt.bot/api"


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class CryptoBotProvider(PaymentProvider):
    code = "cryptobot"
    title = "CryptoBot (Crypto Pay)"
    description = "Invoices paid inside Telegram via @CryptoBot. Supports USDT, TON, BTC, LTC and more."
    supports_webhook = True
    supports_polling = True
    supports_refund = True
    config_fields = [
        ConfigField("api_token", "API token", "password", secret=True, required=True,
                    help="Create an app in @CryptoBot → Crypto Pay → My Apps."),
        ConfigField("testnet", "Use testnet (@CryptoTestnetBot)", "boolean", default=False),
        ConfigField("accepted_assets", "Accepted assets", "text", default="USDT,TON,BTC,LTC,ETH",
                    help="Comma-separated list. Leave empty to accept all supported assets."),
        ConfigField("allow_refund_transfers", "Refund via transfer", "boolean", default=False,
                    help="Refunds are sent with the `transfer` method from your app balance."),
    ]

    @property
    def base_url(self) -> str:
        return TESTNET if self.public.get("testnet") else MAINNET

    async def _call(self, method: str, payload: dict[str, Any]) -> Any:
        token = self.secret.get("api_token")
        if not token:
            raise ProviderUnavailable("CryptoBot API token is not configured")
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(f"{self.base_url}/{method}", json=payload,
                                      headers={"Crypto-Pay-API-Token": token})
            data = r.json()
        except Exception as exc:
            raise ProviderUnavailable(f"CryptoBot unreachable: {exc}") from exc
        if not data.get("ok"):
            err = data.get("error", {})
            raise ProviderUnavailable(f"CryptoBot error: {err.get('name') or err}")
        return data["result"]

    async def create_payment(self, ctx: PaymentContext) -> PaymentCreated:
        expires_in = max(60, int((ctx.expires_at - utcnow()).total_seconds()))
        payload: dict[str, Any] = {
            "currency_type": "fiat",
            "fiat": ctx.order.currency,
            "amount": str(ctx.payment.amount),
            "description": ctx.description[:1024],
            "payload": ctx.payment.reference,
            "expires_in": min(expires_in, 2678400),
            "allow_comments": False,
            "allow_anonymous": False,
        }
        assets = (self.public.get("accepted_assets") or "").replace(" ", "")
        if assets:
            payload["accepted_assets"] = assets
        invoice = await self._call("createInvoice", payload)
        return PaymentCreated(
            kind="redirect",
            external_id=str(invoice["invoice_id"]),
            pay_url=invoice.get("bot_invoice_url") or invoice.get("pay_url") or invoice.get("mini_app_invoice_url"),
            expires_at=ctx.expires_at,
            extra={"hash": invoice.get("hash")},
        )

    def _to_result(self, invoice: dict[str, Any]) -> ProviderResult:
        status_map = {"active": PaymentStatus.PENDING, "paid": PaymentStatus.PAID, "expired": PaymentStatus.EXPIRED}
        status = status_map.get(invoice.get("status", ""), PaymentStatus.PENDING)
        return ProviderResult(
            status=status,
            external_id=str(invoice.get("invoice_id")),
            reference=invoice.get("payload"),
            tx_hash=None,
            received_amount=Decimal(str(invoice["paid_amount"])) if invoice.get("paid_amount") else None,
            received_currency=invoice.get("paid_asset"),
            paid_at=_parse_dt(invoice.get("paid_at")),
            raw={k: invoice.get(k) for k in ("invoice_id", "status", "paid_asset", "paid_amount", "paid_usd_rate",
                                              "fee_amount", "paid_at", "amount", "fiat")},
        )

    async def check_payment(self, payment: Payment) -> ProviderResult | None:
        if not payment.external_id:
            return None
        result = await self._call("getInvoices", {"invoice_ids": payment.external_id})
        items = result.get("items", []) if isinstance(result, dict) else result
        if not items:
            return None
        return self._to_result(items[0])

    async def refund_payment(self, payment: Payment, amount: Decimal, user: User) -> RefundResult:
        if not self.public.get("allow_refund_transfers"):
            return await super().refund_payment(payment, amount, user)
        asset = payment.extra.get("paid_asset") or payment.pay_currency
        paid_amount = Decimal(str(payment.extra.get("paid_amount") or 0))
        if not asset or paid_amount <= 0:
            return RefundResult(ok=False, message="Original paid asset unknown")
        share = (amount / payment.amount) if payment.amount else Decimal("1")
        crypto_amount = (paid_amount * share).quantize(Decimal("0.00000001"))
        transfer = await self._call("transfer", {
            "user_id": user.telegram_id, "asset": asset, "amount": str(crypto_amount),
            "spend_id": f"refund-{payment.reference}-{int(amount * 100)}", "comment": "Refund",
        })
        return RefundResult(ok=True, external_id=str(transfer.get("transfer_id")))

    async def health_check(self) -> tuple[bool, str]:
        try:
            me = await self._call("getMe", {})
            return True, f"App: {me.get('name')}"
        except ProviderUnavailable as exc:
            return False, str(exc)

    @classmethod
    async def handle_webhook(
        cls, headers: dict[str, str], body: bytes, methods: list[tuple[PaymentMethod, dict[str, Any], dict[str, Any]]]
    ) -> WebhookResult:
        signature = headers.get("crypto-pay-api-signature", "")
        data = orjson.loads(body) if body else {}
        event_id = str(data.get("update_id", ""))
        for method, public, secret in methods:
            token = secret.get("api_token")
            if not token:
                continue
            key = hashlib.sha256(token.encode()).digest()
            expected = hmac.new(key, body, hashlib.sha256).hexdigest()
            if signature and hmac.compare_digest(expected, signature):
                provider = cls(method, public, secret)
                invoice = data.get("payload") or {}
                result = provider._to_result(invoice) if data.get("update_type") == "invoice_paid" else None
                return WebhookResult(event_id=event_id or f"inv-{invoice.get('invoice_id')}",
                                     event_type=data.get("update_type", "unknown"), signature_valid=True,
                                     result=result, method_code=method.code, payload=data)
        return WebhookResult(event_id=event_id or "invalid", event_type=data.get("update_type", "unknown"),
                             signature_valid=False, result=None, payload=data)
