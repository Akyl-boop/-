"""Outgoing webhooks for integrations (signed, queued, retried with backoff)."""

from __future__ import annotations

import hashlib
import hmac
import time
import uuid
from typing import Any

import httpx
import orjson
from sqlalchemy import select

from app.core.crypto import decrypt_str
from app.core.database import session_scope
from app.core.logging import get_logger
from app.core.queue import enqueue
from app.core.utils import utcnow
from app.models import WebhookDelivery, WebhookEndpoint

log = get_logger(__name__)

EVENTS = ["order.created", "order.paid", "order.completed", "order.refunded", "customer.created", "ticket.created"]
MAX_ATTEMPTS = 6


async def dispatch(event: str, data: dict[str, Any]) -> None:
    try:
        async with session_scope() as s:
            endpoints = (
                await s.execute(select(WebhookEndpoint).where(WebhookEndpoint.enabled.is_(True)))
            ).scalars().all()
            ids = []
            for ep in endpoints:
                if ep.events and event not in ep.events:
                    continue
                d = WebhookDelivery(id=uuid.uuid4(), endpoint_id=ep.id, event=event,
                                    payload={"event": event, "data": data, "created_at": utcnow().isoformat()})
                s.add(d)
                ids.append(str(d.id))
        for did in ids:
            await enqueue("deliver_webhook", did)
    except Exception as exc:
        log.warning("webhook_dispatch_failed", event=event, error=str(exc))


def sign(secret: str, timestamp: str, body: bytes) -> str:
    return hmac.new(secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()


async def deliver(delivery_id: str) -> bool:
    """Returns True when finished (success or gave up); False → caller should retry."""
    async with session_scope() as s:
        d = await s.get(WebhookDelivery, uuid.UUID(delivery_id))
        if d is None or d.status == "success":
            return True
        ep = await s.get(WebhookEndpoint, d.endpoint_id)
        if ep is None or not ep.enabled:
            d.status = "failed"
            d.error = "endpoint disabled"
            return True
        body = orjson.dumps(d.payload, default=str)
        ts = str(int(time.time()))
        secret = decrypt_str(ep.secret_enc) or ""
        d.attempts += 1
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(ep.url, content=body, headers={
                    "Content-Type": "application/json", "X-Nexa-Event": d.event, "X-Nexa-Delivery": str(d.id),
                    "X-Nexa-Timestamp": ts, "X-Nexa-Signature": f"sha256={sign(secret, ts, body)}",
                })
            d.response_code = r.status_code
            ep.last_status = r.status_code
            ep.last_delivery_at = utcnow()
            if 200 <= r.status_code < 300:
                d.status = "success"
                d.delivered_at = utcnow()
                d.error = None
                return True
            d.error = f"HTTP {r.status_code}"
        except Exception as exc:
            d.error = str(exc)[:500]
        if d.attempts >= MAX_ATTEMPTS:
            d.status = "failed"
            return True
        return False
