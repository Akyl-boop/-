"""Payment provider abstraction.

Every payment integration is an isolated `PaymentProvider` implementation registered in
`app.payments.registry`. The core never talks to a provider API directly — it only uses
this interface, so new providers can be added without touching order/fulfillment logic.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, ClassVar, Literal

from app.models import Order, Payment, PaymentMethod, User
from app.models.enums import PaymentStatus


@dataclass(frozen=True)
class ConfigField:
    """Describes one configuration field so the dashboard can render a form for any provider."""

    key: str
    label: str
    type: Literal["text", "password", "number", "boolean", "select", "textarea", "i18n", "list"] = "text"
    secret: bool = False
    required: bool = False
    default: Any = None
    help: str | None = None
    options: list[dict[str, str]] | None = None


@dataclass
class PaymentContext:
    payment: Payment
    order: Order
    user: User
    method: PaymentMethod
    public_config: dict[str, Any]
    secret_config: dict[str, Any]
    lang: str
    expires_at: datetime
    description: str


@dataclass
class PaymentCreated:
    """What the customer needs to pay (rendered by the bot)."""

    kind: Literal["redirect", "crypto", "manual", "telegram_invoice", "instant"]
    external_id: str | None = None
    pay_url: str | None = None
    pay_amount: Decimal | None = None
    pay_currency: str | None = None
    network: str | None = None
    address: str | None = None
    memo: str | None = None
    expires_at: datetime | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class ProviderResult:
    """Normalised status reported by a provider (from polling or a webhook)."""

    status: PaymentStatus
    external_id: str | None = None
    reference: str | None = None
    tx_hash: str | None = None
    confirmations: int | None = None
    received_amount: Decimal | None = None
    received_currency: str | None = None
    paid_at: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)
    message: str | None = None


@dataclass
class WebhookResult:
    event_id: str
    event_type: str
    signature_valid: bool
    result: ProviderResult | None
    method_code: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    response: dict[str, Any] = field(default_factory=lambda: {"ok": True})


@dataclass
class RefundResult:
    ok: bool
    external_id: str | None = None
    message: str | None = None


class ProviderUnavailable(Exception):
    """Provider API is down / misconfigured; the customer should pick another method."""


class RefundNotSupported(Exception):
    pass


class PaymentProvider(ABC):
    code: ClassVar[str]
    title: ClassVar[str]
    description: ClassVar[str] = ""
    supports_webhook: ClassVar[bool] = False
    supports_polling: ClassVar[bool] = False
    supports_refund: ClassVar[bool] = False
    config_fields: ClassVar[list[ConfigField]] = []

    def __init__(self, method: PaymentMethod, public_config: dict[str, Any], secret_config: dict[str, Any]) -> None:
        self.method = method
        self.public = public_config
        self.secret = secret_config

    @abstractmethod
    async def create_payment(self, ctx: PaymentContext) -> PaymentCreated: ...

    async def check_payment(self, payment: Payment) -> ProviderResult | None:
        """Poll the provider. Return None if the provider cannot be polled."""
        return None

    async def get_status(self, payment: Payment) -> PaymentStatus:
        result = await self.check_payment(payment)
        return result.status if result else payment.status

    async def refund_payment(self, payment: Payment, amount: Decimal, user: User) -> RefundResult:
        raise RefundNotSupported(f"{self.title} does not support automatic refunds")

    async def health_check(self) -> tuple[bool, str]:
        return True, "OK"

    @classmethod
    async def handle_webhook(
        cls, headers: dict[str, str], body: bytes, methods: list[tuple[PaymentMethod, dict[str, Any], dict[str, Any]]]
    ) -> WebhookResult:
        """Validate and parse an incoming webhook. `methods` are all configured methods of this provider."""
        raise NotImplementedError

    def missing_config(self) -> list[str]:
        missing = []
        for f in self.config_fields:
            if not f.required:
                continue
            value = (self.secret if f.secret else self.public).get(f.key)
            if value in (None, "", []):
                missing.append(f.label)
        return missing
