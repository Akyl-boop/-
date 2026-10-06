"""Small shared helpers."""

from __future__ import annotations

import re
import secrets
import string
import unicodedata
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

_SLUG_RE = re.compile(r"[^a-z0-9]+")


def utcnow() -> datetime:
    return datetime.now(UTC)


def slugify(value: str, max_len: int = 80) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = _SLUG_RE.sub("-", value.lower()).strip("-")
    return value[:max_len] or secrets.token_hex(4)


def money(value: Any, places: str = "0.01") -> Decimal:
    return Decimal(str(value)).quantize(Decimal(places), rounding=ROUND_HALF_UP)


def random_code(length: int = 8, alphabet: str = string.ascii_uppercase + string.digits) -> str:
    # Avoid visually ambiguous characters
    alphabet = alphabet.translate(str.maketrans("", "", "0O1IL"))
    return "".join(secrets.choice(alphabet) for _ in range(length))


def i18n_get(value: dict[str, str] | str | None, lang: str, fallback: str = "en") -> str:
    """Resolve a translatable JSON field ({"en": "...", "ru": "..."})."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return value.get(lang) or value.get(fallback) or next((v for v in value.values() if v), "")


def mask_secret(value: str | None, keep: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= keep * 2:
        return "•" * len(value)
    return value[:keep] + "•" * 6 + value[-keep:]
