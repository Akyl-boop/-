"""Payment provider registry."""

from __future__ import annotations

from typing import Any

from app.core.crypto import decrypt_json
from app.models import PaymentMethod
from app.payments.base import PaymentProvider
from app.payments.providers.balance import BalanceProvider
from app.payments.providers.crypto_direct import CryptoDirectProvider
from app.payments.providers.cryptobot import CryptoBotProvider
from app.payments.providers.manual import ManualProvider
from app.payments.providers.telegram import TelegramCardProvider, TelegramStarsProvider

PROVIDERS: dict[str, type[PaymentProvider]] = {
    p.code: p
    for p in (CryptoBotProvider, CryptoDirectProvider, TelegramStarsProvider, TelegramCardProvider, ManualProvider,
              BalanceProvider)
}


def provider_class(code: str) -> type[PaymentProvider]:
    if code not in PROVIDERS:
        raise KeyError(f"Unknown payment provider {code}")
    return PROVIDERS[code]


def secret_config(method: PaymentMethod) -> dict[str, Any]:
    return decrypt_json(method.secret_config_enc) if method.secret_config_enc else {}


def build_provider(method: PaymentMethod) -> PaymentProvider:
    cls = provider_class(method.provider)
    return cls(method, dict(method.public_config or {}), secret_config(method))


def describe_providers() -> list[dict[str, Any]]:
    return [
        {
            "code": cls.code, "title": cls.title, "description": cls.description,
            "supports_webhook": cls.supports_webhook, "supports_polling": cls.supports_polling,
            "supports_refund": cls.supports_refund,
            "fields": [
                {"key": f.key, "label": f.label, "type": f.type, "secret": f.secret, "required": f.required,
                 "default": f.default, "help": f.help, "options": f.options}
                for f in cls.config_fields
            ],
        }
        for cls in PROVIDERS.values()
    ]
