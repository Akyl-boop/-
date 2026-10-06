"""Real-time admin event bus (Redis pub/sub → Server-Sent Events)."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import orjson

from app.core.logging import get_logger
from app.core.redis import redis

ADMIN_CHANNEL = "nexa:admin-events"
CONFIG_CHANNEL = "nexa:config-changed"
log = get_logger(__name__)


async def publish_admin_event(event_type: str, data: dict[str, Any] | None = None) -> None:
    payload = {"type": event_type, "data": data or {}, "ts": datetime.now(UTC).isoformat()}
    try:
        await redis.publish(ADMIN_CHANNEL, orjson.dumps(payload, default=str).decode())
    except Exception as exc:  # never break business flow because of realtime updates
        log.warning("admin_event_publish_failed", error=str(exc), event_type=event_type)


async def publish_config_changed(scope: str) -> None:
    try:
        await redis.publish(CONFIG_CHANNEL, scope)
    except Exception as exc:
        log.warning("config_event_publish_failed", error=str(exc))
