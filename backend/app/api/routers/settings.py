"""Settings, feature flags and integrations (outgoing webhooks, fulfillment callbacks)."""

from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from typing import Any

import orjson
from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DB, Auth, Paging, Perm, page_response, paginate
from app.core.crypto import decrypt_str, encrypt_str
from app.core.errors import NotFound, Unauthorized, ValidationFailed
from app.fulfillment.service import deliver_manually
from app.models import OrderItem, WebhookDelivery, WebhookEndpoint
from app.services.audit import audit
from app.services.settings import DEFAULTS, GROUPS, NOTIFICATION_TYPES, SECRET_KEYS, settings_store
from app.services.webhooks_out import EVENTS

router = APIRouter(tags=["settings"])

GROUP_PERMS = {"notifications": "notifications.manage", "integrations": "integrations.manage"}


@router.get("/settings")
async def get_settings(session: DB, auth: Auth) -> dict[str, Any]:
    data = await settings_store.all(session)
    out = {g: data[g] for g in GROUPS}
    out["integration_secrets"] = await settings_store.masked_secrets("integration_secrets")
    out["_meta"] = {"notification_types": NOTIFICATION_TYPES, "groups": GROUPS, "can_edit": auth.can("settings.edit")}
    return out


@router.get("/settings/public")
async def public_settings() -> dict[str, Any]:
    """Branding needed before login (store/dashboard name, accent, logo)."""
    general = await settings_store.group("general")
    branding = await settings_store.group("branding")
    return {"store_name": general["store_name"], "dashboard_name": general["dashboard_name"], "accent": branding["accent"],
            "default_theme": branding["default_theme"], "logo_media_id": branding.get("logo_media_id"),
            "favicon_media_id": branding.get("favicon_media_id"), "currency": general["currency"],
            "currency_symbol": general.get("currency_symbol"), "timezone": general.get("timezone")}


def _validate(group: str, values: dict[str, Any]) -> dict[str, Any]:
    defaults = DEFAULTS[group]
    clean: dict[str, Any] = {}
    for k, v in values.items():
        if k not in defaults:
            continue
        d = defaults[k]
        if isinstance(d, bool):
            if not isinstance(v, bool):
                raise ValidationFailed(f"{group}.{k} must be true/false")
        elif isinstance(d, int | float) and not isinstance(d, bool):
            try:
                v = float(v) if isinstance(d, float) or (isinstance(v, str) and "." in v) else int(v)
            except (TypeError, ValueError) as exc:
                raise ValidationFailed(f"{group}.{k} must be a number") from exc
            if v < 0:
                raise ValidationFailed(f"{group}.{k} must be positive")
        elif isinstance(d, list) and not isinstance(v, list):
            raise ValidationFailed(f"{group}.{k} must be a list")
        elif isinstance(d, str) and v is not None and not isinstance(v, str):
            raise ValidationFailed(f"{group}.{k} must be text")
        clean[k] = v
    if group == "general":
        if "order_prefix" in clean and not str(clean["order_prefix"]).replace("-", "").isalnum():
            raise ValidationFailed("Order prefix may contain letters, digits and dashes only")
        if "timezone" in clean:
            from zoneinfo import ZoneInfo

            try:
                ZoneInfo(clean["timezone"])
            except Exception as exc:
                raise ValidationFailed("Unknown timezone") from exc
    if group == "maintenance" and "bypass_telegram_ids" in clean:
        clean["bypass_telegram_ids"] = [int(x) for x in clean["bypass_telegram_ids"] if str(x).lstrip("-").isdigit()]
    if group == "bot" and "announcement" in clean:
        from app.security.html import sanitize_telegram_html

        clean["announcement"] = sanitize_telegram_html(clean["announcement"])
    return clean


@router.put("/settings/{group}")
async def update_settings(group: str, body: dict[str, Any], session: DB, auth: Auth) -> dict[str, Any]:
    if group not in DEFAULTS:
        raise NotFound("Unknown settings group")
    perm = GROUP_PERMS.get(group, "settings.edit")
    if not auth.can(perm) and not auth.can("settings.edit"):
        from app.core.errors import Forbidden

        raise Forbidden(f"Missing permission: {perm}")
    old = (await settings_store.all(session))[group]
    clean = _validate(group, body)
    new = await settings_store.update_group(session, group, clean, admin_id=auth.admin.id)
    changed = {k: v for k, v in clean.items() if old.get(k) != v}
    await audit(session, auth.admin, f"settings.{group}", f"Changed {group} settings: {', '.join(changed) or 'no changes'}",
                entity_type="settings", entity_id=group, old={k: old.get(k) for k in changed}, new=changed)
    return new


@router.put("/settings-secrets/{key}")
async def update_secrets(key: str, body: dict[str, str | None], session: DB, auth: Perm("integrations.manage")) -> dict[str, Any]:
    if key not in SECRET_KEYS:
        raise NotFound("Unknown secret group")
    await settings_store.update_secrets(session, key, body, admin_id=auth.admin.id)
    await audit(session, auth.admin, "settings.secrets", f"Changed integration secrets: {', '.join(k for k, v in body.items() if v is not None)}",
                entity_type="settings", entity_id=key)
    return {"status": "ok"}


# ─── Outgoing webhooks ──────────────────────────────────────────────────────


class EndpointIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    url: str = Field(pattern=r"^https?://", max_length=500)
    events: list[str] = Field(default_factory=list)
    enabled: bool = True


def ep_out(e: WebhookEndpoint, secret: str | None = None) -> dict[str, Any]:
    return {"id": e.id, "name": e.name, "url": e.url, "events": e.events, "enabled": e.enabled,
            "last_status": e.last_status, "last_delivery_at": e.last_delivery_at, "created_at": e.created_at,
            **({"secret": secret} if secret else {})}


@router.get("/integrations/webhooks")
async def list_endpoints(session: DB, auth: Perm("integrations.manage")) -> dict[str, Any]:
    eps = (await session.execute(select(WebhookEndpoint).order_by(WebhookEndpoint.id))).scalars().all()
    return {"events": EVENTS, "endpoints": [ep_out(e) for e in eps]}


@router.post("/integrations/webhooks", status_code=201)
async def create_endpoint(body: EndpointIn, session: DB, auth: Perm("integrations.manage")) -> dict[str, Any]:
    if any(ev not in EVENTS for ev in body.events):
        raise ValidationFailed("Unknown event")
    secret = "whsec_" + secrets.token_urlsafe(32)
    e = WebhookEndpoint(name=body.name, url=body.url, events=body.events, enabled=body.enabled, secret_enc=encrypt_str(secret) or "")
    session.add(e)
    await session.flush()
    await audit(session, auth.admin, "integration.webhook_create", f"Added webhook endpoint {body.url}")
    return ep_out(e, secret)


@router.put("/integrations/webhooks/{eid}")
async def update_endpoint(eid: int, body: EndpointIn, session: DB, auth: Perm("integrations.manage")) -> dict[str, Any]:
    e = await session.get(WebhookEndpoint, eid)
    if e is None:
        raise NotFound("Endpoint not found")
    e.name, e.url, e.events, e.enabled = body.name, body.url, body.events, body.enabled
    return ep_out(e)


@router.post("/integrations/webhooks/{eid}/rotate-secret")
async def rotate_secret(eid: int, session: DB, auth: Perm("integrations.manage")) -> dict[str, Any]:
    e = await session.get(WebhookEndpoint, eid)
    if e is None:
        raise NotFound("Endpoint not found")
    secret = "whsec_" + secrets.token_urlsafe(32)
    e.secret_enc = encrypt_str(secret) or ""
    await audit(session, auth.admin, "integration.webhook_rotate", f"Rotated secret of {e.url}")
    return ep_out(e, secret)


@router.delete("/integrations/webhooks/{eid}")
async def delete_endpoint(eid: int, session: DB, auth: Perm("integrations.manage")) -> dict[str, str]:
    e = await session.get(WebhookEndpoint, eid)
    if e:
        await session.delete(e)
    await audit(session, auth.admin, "integration.webhook_delete", f"Deleted webhook endpoint #{eid}")
    return {"status": "ok"}


@router.post("/integrations/webhooks/{eid}/test")
async def test_endpoint(eid: int, session: DB, auth: Perm("integrations.manage")) -> dict[str, Any]:
    from app.core.queue import enqueue

    e = await session.get(WebhookEndpoint, eid)
    if e is None:
        raise NotFound("Endpoint not found")
    d = WebhookDelivery(id=uuid.uuid4(), endpoint_id=e.id, event="test.ping", payload={"event": "test.ping", "data": {"hello": "world"}})
    session.add(d)
    await session.commit()
    from app.services.webhooks_out import deliver

    await deliver(str(d.id))
    await session.refresh(d)
    if d.status == "pending":
        await enqueue("deliver_webhook", str(d.id))
    return {"status": d.status, "response_code": d.response_code, "error": d.error}


@router.get("/integrations/webhooks/{eid}/deliveries")
async def deliveries(eid: int, session: DB, auth: Perm("integrations.manage"), paging: Paging) -> dict[str, Any]:
    items, total = await paginate(session, select(WebhookDelivery).where(WebhookDelivery.endpoint_id == eid)
                                  .order_by(WebhookDelivery.created_at.desc()), paging)
    return page_response([{"id": str(d.id), "event": d.event, "status": d.status, "attempts": d.attempts,
                           "response_code": d.response_code, "error": d.error, "created_at": d.created_at,
                           "delivered_at": d.delivered_at} for d in items], total, paging)


# ─── Fulfillment callback (public, HMAC-signed) ─────────────────────────────


@router.post("/integrations/fulfillment/{order_item_id}", include_in_schema=True)
async def fulfillment_callback(order_item_id: int, request: Request, session: DB) -> dict[str, Any]:
    """External fulfillment systems deliver goods here: body {"items": ["..."]}, header X-Nexa-Signature = HMAC-SHA256(body, secret)."""
    body = await request.body()
    item = await session.get(OrderItem, order_item_id)
    if item is None:
        raise NotFound("Order item not found")
    from app.models import Product, ProductVariant

    product = await session.get(Product, item.product_id) if item.product_id else None
    variant = await session.get(ProductVariant, item.variant_id) if item.variant_id else None
    cfg = {**((product.fulfillment_config if product else None) or {}), **((variant.fulfillment_config if variant else None) or {})}
    secret = decrypt_str(cfg.get("secret_enc")) if cfg.get("secret_enc") else None
    if not secret:
        raise Unauthorized("Callbacks are not configured for this product")
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get("x-nexa-signature", "")):
        raise Unauthorized("Invalid signature")
    data = orjson.loads(body or b"{}")
    items = data.get("items")
    if not isinstance(items, list) or not items:
        raise ValidationFailed("items must be a non-empty list")
    await deliver_manually(session, order_item_id, [str(i) for i in items], None, source="webhook")
    return {"status": "ok"}
