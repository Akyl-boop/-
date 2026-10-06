"""TOTP two-factor authentication helpers."""

from __future__ import annotations

import base64
import io
import secrets

import pyotp
import qrcode
import qrcode.image.svg

from app.core.crypto import sha256_hex


def new_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, email: str, issuer: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=issuer)


def verify(secret: str, code: str) -> bool:
    code = (code or "").replace(" ", "")
    return code.isdigit() and pyotp.TOTP(secret).verify(code, valid_window=1)


def qr_svg_data_uri(data: str) -> str:
    img = qrcode.make(data, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return "data:image/svg+xml;base64," + base64.b64encode(buf.getvalue()).decode()


def generate_recovery_codes(n: int = 8) -> tuple[list[str], list[str]]:
    codes = [f"{secrets.token_hex(3)}-{secrets.token_hex(3)}" for _ in range(n)]
    return codes, [sha256_hex(c) for c in codes]
