"""Money formatting according to store settings."""

from __future__ import annotations

from decimal import Decimal

from app.core.utils import money
from app.services.settings import settings_store

_SYMBOLS = {"USD": "$", "EUR": "€", "GBP": "£", "RUB": "₽", "CNY": "¥", "UAH": "₴", "KZT": "₸", "TRY": "₺",
            "INR": "₹", "XTR": "⭐"}


def format_amount(amount: Decimal | float | int | None, currency: str, symbol: str | None = None,
                  position: str = "before") -> str:
    value = money(amount or 0)
    text = f"{value:,.2f}".replace(",", " ")
    if text.endswith(".00"):
        text = text[:-3]
    sym = symbol or _SYMBOLS.get(currency.upper())
    if not sym:
        return f"{text} {currency}"
    return f"{sym}{text}" if position == "before" else f"{text} {sym}"


async def fmt(amount: Decimal | float | int | None, currency: str | None = None) -> str:
    general = await settings_store.group("general")
    cur = currency or general["currency"]
    sym = general.get("currency_symbol") if cur == general["currency"] else None
    return format_amount(amount, cur, sym, general.get("currency_position", "before"))


def format_crypto(amount: Decimal | None, decimals: int = 6) -> str:
    if amount is None:
        return "0"
    q = Decimal(1).scaleb(-decimals)
    s = f"{Decimal(amount).quantize(q):f}"
    return s.rstrip("0").rstrip(".") if "." in s else s
