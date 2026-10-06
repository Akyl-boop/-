"""Payments, payment methods (provider configuration) and crypto address pools."""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select

from app.api.deps import DB, Paging, Perm, page_response, paginate
from app.api.serializers import payment_method_out, payment_out, user_brief
from app.core.crypto import encrypt_json
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.utils import slugify, utcnow
from app.models import CryptoAddress, Order, Payment, PaymentMethod
from app.payments import service as payments
from app.payments.base import ProviderUnavailable
from app.payments.registry import PROVIDERS, build_provider, describe_providers, secret_config
from app.services.audit import audit

router = APIRouter(tags=["payments"])


@router.get("/payments")
async def list_payments(session: DB, auth: Perm("payments.view"), paging: Paging, status: str | None = None,
                        method: str | None = None, q: str | None = None, date_from: date | None = None,
                        date_to: date | None = None) -> dict[str, Any]:
    query = select(Payment).order_by(Payment.created_at.desc())
    if status:
        query = query.where(Payment.status.in_(status.split(",")))
    if method:
        query = query.where(Payment.method_code == method)
    if q:
        term = q.strip()
        query = query.where(or_(Payment.reference.ilike(f"%{term}%"), Payment.tx_hash.ilike(f"%{term}%"),
                                Payment.external_id == term, Payment.address == term,
                                Payment.order_id.in_(select(Order.id).where(Order.number.ilike(f"%{term}%")))))
    if date_from:
        query = query.where(Payment.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        query = query.where(Payment.created_at <= datetime.combine(date_to, time.max))
    items, total = await paginate(session, query, paging)
    orders = {o.id: o for o in (await session.execute(select(Order).where(Order.id.in_([p.order_id for p in items] or [0])))).scalars()}
    out = []
    for p in items:
        d = payment_out(p)
        o = orders.get(p.order_id)
        d["order_number"] = o.number if o else None
        d["customer"] = user_brief(o.user) if o else None
        out.append(d)
    return page_response(out, total, paging)


@router.post("/payments/{payment_id}/check")
async def recheck(payment_id: uuid.UUID, session: DB, auth: Perm("payments.view")) -> dict[str, Any]:
    try:
        p = await payments.refresh_payment(session, payment_id)
    except ProviderUnavailable as exc:
        raise ValidationFailed(f"Provider unavailable: {exc}") from exc
    return payment_out(p)


@router.get("/payment-providers")
async def providers(auth: Perm("payments.view")) -> list[dict[str, Any]]:
    return describe_providers()


def _secret_keys(provider: str) -> list[str]:
    cls = PROVIDERS.get(provider)
    return [f.key for f in cls.config_fields if f.secret] if cls else []


@router.get("/payment-methods")
async def list_methods(session: DB, auth: Perm("payments.view")) -> list[dict[str, Any]]:
    methods = (await session.execute(select(PaymentMethod).order_by(PaymentMethod.sort_order, PaymentMethod.id))).scalars().all()
    usage = dict((await session.execute(select(Payment.method_code, func.count()).where(Payment.status == "paid")
                                        .group_by(Payment.method_code))).all())
    out = []
    for m in methods:
        d = payment_method_out(m, _secret_keys(m.provider), secret_config(m))
        d["paid_count"] = usage.get(m.code, 0)
        provider = build_provider(m) if m.provider in PROVIDERS else None
        d["missing"] = provider.missing_config() if provider else ["Unknown provider"]
        d["webhook_url"] = None
        if provider and provider.supports_webhook:
            from app.core.config import settings

            d["webhook_url"] = f"{settings.webhook_base}/api/webhooks/payments/{m.provider}"
        out.append(d)
    return out


class MethodIn(BaseModel):
    code: str | None = Field(None, max_length=48)
    provider: str
    name: dict[str, str]
    description: dict[str, str] | None = None
    emoji: str | None = Field(None, max_length=32)
    custom_emoji_id: str | None = Field(None, max_length=32, pattern=r"^\d*$")
    enabled: bool = False
    sort_order: int = 0
    public_config: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, str | None] = Field(default_factory=dict, description="Only send keys you want to change; '' clears")
    min_amount: Decimal | None = Field(None, ge=0)
    max_amount: Decimal | None = Field(None, ge=0)
    fee_percent: Decimal = Field(Decimal("0"), ge=0, le=50)


def _apply_method(m: PaymentMethod, body: MethodIn) -> None:
    cls = PROVIDERS.get(body.provider)
    if cls is None:
        raise ValidationFailed("Unknown provider")
    public_keys = {f.key for f in cls.config_fields if not f.secret} | {"expiry_minutes"}
    m.provider = body.provider
    m.name = {k: v[:64] for k, v in body.name.items() if v}
    m.description = body.description
    m.emoji = body.emoji
    m.custom_emoji_id = body.custom_emoji_id or None
    m.sort_order = body.sort_order
    m.public_config = {k: v for k, v in body.public_config.items() if k in public_keys}
    m.min_amount, m.max_amount, m.fee_percent = body.min_amount, body.max_amount, body.fee_percent
    secret_keys = set(_secret_keys(body.provider))
    current = secret_config(m)
    for k, v in body.secrets.items():
        if k not in secret_keys or v is None:
            continue
        if v == "":
            current.pop(k, None)
        else:
            current[k] = v.strip()
    m.secret_config_enc = encrypt_json(current) if current else None
    if body.enabled:
        missing = build_provider(m).missing_config()
        if missing:
            raise ValidationFailed("Cannot enable — missing: " + ", ".join(missing))
    m.enabled = body.enabled


@router.post("/payment-methods", status_code=201)
async def create_method(body: MethodIn, session: DB, auth: Perm("payments.edit")) -> dict[str, Any]:
    code = slugify(body.code or body.name.get("en") or body.provider).replace("-", "_")[:48]
    if (await session.execute(select(PaymentMethod).where(PaymentMethod.code == code))).first():
        raise Conflict(f"Payment method code '{code}' already exists")
    m = PaymentMethod(code=code, provider=body.provider, name={})
    _apply_method(m, body)
    session.add(m)
    await session.flush()
    await audit(session, auth.admin, "payment_method.create", f"Created payment method {code}", entity_type="payment_method",
                entity_id=m.id, new={"provider": m.provider, "enabled": m.enabled})
    return payment_method_out(m, _secret_keys(m.provider), secret_config(m))


@router.put("/payment-methods/{method_id}")
async def update_method(method_id: int, body: MethodIn, session: DB, auth: Perm("payments.edit")) -> dict[str, Any]:
    m = await session.get(PaymentMethod, method_id)
    if m is None:
        raise NotFound("Payment method not found")
    old = {"enabled": m.enabled, "public_config": dict(m.public_config or {}), "fee_percent": m.fee_percent,
           "min_amount": m.min_amount, "max_amount": m.max_amount}
    _apply_method(m, body)
    changed_secrets = [k for k, v in body.secrets.items() if v is not None]
    await audit(session, auth.admin, "payment_method.update", f"Changed payment configuration of {m.code}",
                entity_type="payment_method", entity_id=m.id, old=old,
                new={"enabled": m.enabled, "public_config": m.public_config, "fee_percent": m.fee_percent,
                     "min_amount": m.min_amount, "max_amount": m.max_amount, "secrets_changed": changed_secrets})
    return payment_method_out(m, _secret_keys(m.provider), secret_config(m))


class ToggleIn(BaseModel):
    enabled: bool


@router.post("/payment-methods/{method_id}/toggle")
async def toggle_method(method_id: int, body: ToggleIn, session: DB, auth: Perm("payments.edit")) -> dict[str, Any]:
    m = await session.get(PaymentMethod, method_id)
    if m is None:
        raise NotFound("Payment method not found")
    if body.enabled and m.provider in PROVIDERS and (missing := build_provider(m).missing_config()):
        raise ValidationFailed("Cannot enable — missing: " + ", ".join(missing))
    m.enabled = body.enabled
    await audit(session, auth.admin, "payment_method.toggle", f"{'Enabled' if body.enabled else 'Disabled'} {m.code}",
                entity_type="payment_method", entity_id=m.id)
    return {"enabled": m.enabled}


@router.post("/payment-methods/{method_id}/test")
async def test_method(method_id: int, session: DB, auth: Perm("payments.edit")) -> dict[str, Any]:
    m = await session.get(PaymentMethod, method_id)
    if m is None:
        raise NotFound("Payment method not found")
    provider = build_provider(m)
    missing = provider.missing_config()
    if missing:
        ok, message = False, "Missing: " + ", ".join(missing)
    else:
        try:
            ok, message = await provider.health_check()
        except Exception as exc:
            ok, message = False, str(exc)[:300]
    m.last_health_ok, m.last_health_at, m.last_health_error = ok, utcnow(), None if ok else message
    return {"ok": ok, "message": message}


@router.delete("/payment-methods/{method_id}")
async def delete_method(method_id: int, session: DB, auth: Perm("payments.edit")) -> dict[str, str]:
    m = await session.get(PaymentMethod, method_id)
    if m is None:
        raise NotFound("Payment method not found")
    used = (await session.execute(select(func.count()).select_from(Payment).where(Payment.method_code == m.code))).scalar_one()
    if used:
        raise Conflict("This method has payment history — disable it instead of deleting.")
    await session.delete(m)
    await audit(session, auth.admin, "payment_method.delete", f"Deleted payment method {m.code}")
    return {"status": "ok"}


class SortIn(BaseModel):
    ids: list[int]


@router.post("/payment-methods/reorder")
async def reorder_methods(body: SortIn, session: DB, auth: Perm("payments.edit")) -> dict[str, str]:
    methods = {m.id: m for m in (await session.execute(select(PaymentMethod).where(PaymentMethod.id.in_(body.ids)))).scalars()}
    for i, mid in enumerate(body.ids):
        if mid in methods:
            methods[mid].sort_order = i
    return {"status": "ok"}


# ─── Address pool ───────────────────────────────────────────────────────────


@router.get("/crypto-addresses")
async def list_addresses(session: DB, auth: Perm("payments.view"), network: str | None = None) -> list[dict[str, Any]]:
    q = select(CryptoAddress).order_by(CryptoAddress.network, CryptoAddress.id)
    if network:
        q = q.where(CryptoAddress.network == network)
    now = utcnow()
    return [{"id": a.id, "network": a.network, "address": a.address, "label": a.label, "enabled": a.enabled,
             "in_use": bool(a.assigned_payment_id and a.assigned_until and a.assigned_until > now),
             "assigned_until": a.assigned_until} for a in (await session.execute(q)).scalars()]


class AddressesIn(BaseModel):
    network: str = Field(pattern="^(TRC20|BEP20|LTC|TON)$")
    addresses: list[str] = Field(min_length=1, max_length=1000)
    label: str | None = None


@router.post("/crypto-addresses", status_code=201)
async def add_addresses(body: AddressesIn, session: DB, auth: Perm("payments.edit")) -> dict[str, int]:
    from sqlalchemy.dialects.postgresql import insert

    rows = [{"network": body.network, "address": a.strip(), "label": body.label} for a in body.addresses if a.strip()]
    res = await session.execute(insert(CryptoAddress).values(rows).on_conflict_do_nothing().returning(CryptoAddress.id))
    added = len(res.all())
    await audit(session, auth.admin, "crypto_address.add", f"Added {added} {body.network} address(es) to the pool")
    return {"added": added}


@router.delete("/crypto-addresses/{address_id}")
async def delete_address(address_id: int, session: DB, auth: Perm("payments.edit")) -> dict[str, str]:
    a = await session.get(CryptoAddress, address_id)
    if a is None:
        raise NotFound("Address not found")
    if a.assigned_payment_id and a.assigned_until and a.assigned_until > utcnow():
        raise Conflict("Address is currently assigned to an active payment")
    await session.delete(a)
    await audit(session, auth.admin, "crypto_address.delete", f"Removed {a.network} address {a.address}")
    return {"status": "ok"}
