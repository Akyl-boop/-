"""In-process caches invalidated through a Redis version counter (cheap cross-process invalidation)."""

from __future__ import annotations

import time
from collections.abc import Awaitable, Callable
from typing import Any

from app.core.redis import redis


class VersionedCache:
    def __init__(self, name: str, check_interval: float = 1.0) -> None:
        self.version_key = f"cfg:{name}:version"
        self._values: dict[str, Any] = {}
        self._version: str | None = None
        self._checked = 0.0
        self._interval = check_interval

    async def _sync(self) -> None:
        now = time.monotonic()
        if now - self._checked < self._interval:
            return
        self._checked = now
        try:
            v = str(await redis.get(self.version_key) or "0")
        except Exception:
            return
        if v != self._version:
            self._values.clear()
            self._version = v

    async def get(self, key: str, loader: Callable[[], Awaitable[Any]]) -> Any:
        await self._sync()
        if key not in self._values:
            self._values[key] = await loader()
        return self._values[key]

    async def invalidate(self) -> None:
        self._values.clear()
        try:
            await redis.incr(self.version_key)
        except Exception:
            pass


content_cache = VersionedCache("content")
