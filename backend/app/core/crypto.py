"""Symmetric encryption for secrets at rest (payment credentials, inventory, TOTP)."""

from __future__ import annotations

import base64
import hashlib
from typing import Any

import orjson
from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings


def _derive_key() -> bytes:
    raw = settings.encryption_key.get_secret_value()
    if raw:
        return raw.encode()
    if settings.is_production:
        raise RuntimeError("ENCRYPTION_KEY is required in production")
    # Development fallback: derive a deterministic key from SECRET_KEY.
    digest = hashlib.sha256(("enc:" + settings.secret_key.get_secret_value()).encode()).digest()
    return base64.urlsafe_b64encode(digest)


_fernet = Fernet(_derive_key())


def encrypt_str(value: str | None) -> str | None:
    if value is None:
        return None
    return _fernet.encrypt(value.encode()).decode()


def decrypt_str(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return _fernet.decrypt(value.encode()).decode()
    except InvalidToken as exc:  # pragma: no cover - key rotation problem
        raise RuntimeError("Unable to decrypt value — wrong ENCRYPTION_KEY?") from exc


def encrypt_json(value: Any) -> str:
    return _fernet.encrypt(orjson.dumps(value)).decode()


def decrypt_json(value: str | None) -> Any:
    if not value:
        return {}
    return orjson.loads(_fernet.decrypt(value.encode()))


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def generate_fernet_key() -> str:
    return Fernet.generate_key().decode()
