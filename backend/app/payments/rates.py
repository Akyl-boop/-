"""Exchange rates (fiat → crypto) with Redis caching."""

from __future__ import annotations

from decimal import Decimal

import httpx

from app.core.logging import get_logger
from app.core.redis import cache_get, cache_set
from app.payments.base import ProviderUnavailable
from app.services.settings import settings_store

log = get_logger(__name__)

COINGECKO_IDS = {"USDT": "tether", "LTC": "litecoin", "TON": "the-open-network", "BTC": "bitcoin", "ETH": "ethereum",
                 "TRX": "tron", "BNB": "binancecoin"}
STABLE = {"USDT", "USDC"}


async def get_rate(asset: str, fiat: str) -> Decimal:
    """Price of 1 unit of `asset` in `fiat`."""
    asset, fiat = asset.upper(), fiat.upper()
    integrations = await settings_store.group("integrations")
    if asset in STABLE and fiat == "USD" and integrations.get("usdt_rate_fixed", True):
        return Decimal("1")
    key = f"rate:{asset}:{fiat}"
    cached = await cache_get(key)
    if cached:
        return Decimal(str(cached))
    cg_id = COINGECKO_IDS.get(asset)
    if not cg_id:
        raise ProviderUnavailable(f"No rate source for {asset}")
    api_key = await settings_store.secret("integration_secrets", "coingecko_api_key")
    headers = {"x-cg-demo-api-key": api_key} if api_key else {}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": cg_id, "vs_currencies": fiat.lower()}, headers=headers,
            )
            r.raise_for_status()
            value = r.json()[cg_id][fiat.lower()]
    except Exception as exc:
        log.warning("rate_fetch_failed", asset=asset, fiat=fiat, error=str(exc))
        raise ProviderUnavailable("Exchange rate unavailable") from exc
    rate = Decimal(str(value))
    if rate <= 0:
        raise ProviderUnavailable("Invalid exchange rate")
    await cache_set(key, str(rate), ttl=120)
    return rate


async def convert(amount: Decimal, fiat: str, asset: str) -> Decimal:
    rate = await get_rate(asset, fiat)
    markup = Decimal(str((await settings_store.group("integrations")).get("rates_markup_percent") or 0))
    return amount / rate * (Decimal("1") + markup / Decimal("100"))
