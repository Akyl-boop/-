"""Database-driven runtime settings with defaults, typed access and cross-process cache invalidation.

Settings are stored as one JSON document per *group* (general, checkout, features, …).
All processes (API, bot, workers) keep an in-memory copy that is invalidated through a
version counter in Redis, so a change made in the dashboard is visible everywhere within a second.
"""

from __future__ import annotations

import copy
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_json, encrypt_json
from app.core.database import SessionLocal, on_commit
from app.core.redis import redis
from app.core.utils import mask_secret
from app.models import Setting

NOTIFICATION_TYPES: dict[str, str] = {
    "new_order": "New order",
    "payment_received": "Successful payment",
    "large_payment": "Large payment",
    "payment_failed": "Payment failure",
    "refund": "Refund",
    "low_stock": "Low inventory",
    "out_of_stock": "Out of stock",
    "new_customer": "New customer",
    "new_ticket": "New support ticket",
    "ticket_message": "Support message",
    "manual_delivery": "Manual delivery required",
    "suspicious": "Suspicious activity",
    "error": "Application error",
}

DEFAULTS: dict[str, dict[str, Any]] = {
    "general": {
        "store_name": "Nexa Store",
        "dashboard_name": "Nexa",
        "currency": "USD",
        "currency_symbol": "$",
        "currency_position": "before",  # before | after
        "timezone": "UTC",
        "order_prefix": "NX",
        "ticket_prefix": "T",
        "support_username": "",
        "support_url": "",
        "terms_page": "terms",
    },
    "branding": {
        "logo_media_id": None,
        "favicon_media_id": None,
        "accent": "#7c5cff",
        "default_theme": "dark",
        "footer_text": "",
    },
    "bot": {
        "products_per_page": 6,
        "categories_per_row": 2,
        "products_per_row": 1,
        "show_stock_count": True,
        "low_stock_display_threshold": 5,
        "show_sold_count": False,
        "custom_emoji_in_messages": False,  # requires the bot to own a Fragment username
        "custom_emoji_on_buttons": False,  # Bot API: icon_custom_emoji_id
        "button_styles": True,  # Bot API: InlineKeyboardButton.style
        "protect_delivered_content": False,
        "delete_user_inputs": True,
        "announcement": "",
    },
    "checkout": {
        "min_order_amount": 0,
        "max_order_amount": 0,  # 0 = no limit
        "payment_timeout_minutes": 30,
        "max_cart_items": 20,
        "max_open_orders_per_user": 3,
        "large_payment_threshold": 500,
        "auto_cancel_unpaid": True,
    },
    "localization": {
        "default_language": "en",
        "fallback_language": "en",
        "auto_detect": True,
    },
    "features": {
        "cart": True,
        "promo_codes": True,
        "referrals": True,
        "support": True,
        "favorites": True,
        "reviews": True,
        "balance": True,
        "broadcasts": True,
        "notifications": True,
        "search": True,
        "recently_viewed": True,
        "recommendations": True,
        "restock_alerts": True,
        "required_subscription": False,
    },
    "referrals": {
        "reward_type": "percent",  # percent | fixed
        "reward_percent": 5,
        "reward_amount": 1,
        "first_order_only": False,
        "min_purchase": 0,
        "max_rewards_per_referrer": 0,  # 0 = unlimited
    },
    "maintenance": {
        "enabled": False,
        "bypass_telegram_ids": [],
    },
    "subscription": {
        # Channels a user must join before using the bot: [{"chat_id": "@channel", "title": "..", "url": ".."}]
        "channels": [],
    },
    "notifications": {
        "telegram_chat_ids": [],  # extra chats (groups/channels) receiving admin notifications
        "email_recipients": [],
        "webhook_url": "",
        "rules": {
            key: {"enabled": True, "dashboard": True, "telegram": key not in ("ticket_message",), "email": False,
                  "webhook": False}
            for key in NOTIFICATION_TYPES
        },
    },
    "security": {
        "require_2fa": False,
        "ip_allowlist": [],
        "telegram_login_approval": False,
    },
    "backups": {
        "enabled": False,
        "interval_hours": 24,
        "retention_days": 14,
    },
    "integrations": {
        "rates_provider": "coingecko",
        "rates_markup_percent": 0,
        "usdt_rate_fixed": True,
    },
}

# Secret settings (stored encrypted, never returned in clear text)
SECRET_KEYS: dict[str, list[str]] = {
    "integration_secrets": [
        "trongrid_api_key",
        "etherscan_api_key",
        "blockcypher_token",
        "toncenter_api_key",
        "coingecko_api_key",
    ],
}

GROUPS = list(DEFAULTS.keys())

_VERSION_KEY = "cfg:settings:version"


def _deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


class SettingsStore:
    def __init__(self) -> None:
        self._data: dict[str, Any] | None = None
        self._version: str | None = None
        self._checked_at = 0.0

    async def _remote_version(self) -> str:
        try:
            return str(await redis.get(_VERSION_KEY) or "0")
        except Exception:
            return self._version or "0"

    async def _load(self, session: AsyncSession | None = None) -> dict[str, Any]:
        async def _read(s: AsyncSession) -> dict[str, Any]:
            rows = (await s.execute(select(Setting))).scalars().all()
            stored = {r.key: r.value for r in rows}
            data = {g: _deep_merge(DEFAULTS[g], stored.get(g) or {}) for g in GROUPS}
            for sk in SECRET_KEYS:
                raw = stored.get(sk) or {}
                data[sk] = decrypt_json(raw.get("enc")) if raw.get("enc") else {}
            return data

        if session is not None:
            return await _read(session)
        async with SessionLocal() as s:
            return await _read(s)

    async def all(self, session: AsyncSession | None = None) -> dict[str, Any]:
        now = time.monotonic()
        if self._data is None or now - self._checked_at > 1.0:
            version = await self._remote_version()
            self._checked_at = now
            if self._data is None or version != self._version:
                self._data = await self._load(session)
                self._version = version
        return self._data

    async def group(self, name: str) -> dict[str, Any]:
        return (await self.all())[name]

    async def get(self, path: str, default: Any = None) -> Any:
        group, _, key = path.partition(".")
        data = await self.group(group)
        return data.get(key, default) if key else data

    async def feature(self, name: str) -> bool:
        return bool((await self.group("features")).get(name, False))

    async def update_group(
        self, session: AsyncSession, group: str, values: dict[str, Any], admin_id: int | None = None
    ) -> dict[str, Any]:
        if group not in DEFAULTS:
            raise KeyError(group)
        row = await session.get(Setting, group)
        current = row.value if row else {}
        # Only keep keys known in defaults (prevents arbitrary junk)
        allowed = {k: v for k, v in values.items() if k in DEFAULTS[group]}
        merged = _deep_merge(current or {}, allowed)
        if row is None:
            session.add(Setting(key=group, value=merged, updated_by=admin_id))
        else:
            row.value = merged
            row.updated_by = admin_id
        await session.flush()
        on_commit(session, self.invalidate)
        return _deep_merge(DEFAULTS[group], merged)

    async def update_secrets(
        self, session: AsyncSession, key: str, values: dict[str, str | None], admin_id: int | None = None
    ) -> None:
        allowed = SECRET_KEYS[key]
        row = await session.get(Setting, key)
        current = decrypt_json(row.value.get("enc")) if row and row.value.get("enc") else {}
        for k, v in values.items():
            if k not in allowed or v is None:
                continue  # None = unchanged
            if v == "":
                current.pop(k, None)
            else:
                current[k] = v
        value = {"enc": encrypt_json(current)}
        if row is None:
            session.add(Setting(key=key, value=value, updated_by=admin_id))
        else:
            row.value = value
            row.updated_by = admin_id
        await session.flush()
        on_commit(session, self.invalidate)

    async def masked_secrets(self, key: str) -> dict[str, str]:
        data = (await self.all()).get(key, {})
        return {k: mask_secret(data.get(k)) for k in SECRET_KEYS[key]}

    async def secret(self, key: str, name: str) -> str | None:
        return (await self.all()).get(key, {}).get(name)

    async def invalidate(self) -> None:
        self._data = None
        try:
            await redis.incr(_VERSION_KEY)
        except Exception:
            pass


settings_store = SettingsStore()
