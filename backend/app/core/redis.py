"""Shared Redis client, distributed locks and JSON cache helpers."""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import orjson
from redis.asyncio import Redis

from app.core.config import settings

redis: Redis = Redis.from_url(settings.redis_url, decode_responses=True)


class LockNotAcquired(Exception):
    pass


_RELEASE = """
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
"""


@asynccontextmanager
async def redis_lock(key: str, ttl: int = 30, blocking: bool = False, wait: float = 5.0) -> AsyncIterator[None]:
    """Simple safe distributed lock (SET NX PX + compare-and-delete release)."""
    import asyncio

    token = uuid.uuid4().hex
    full = f"lock:{key}"
    deadline = asyncio.get_running_loop().time() + wait
    while True:
        if await redis.set(full, token, nx=True, ex=ttl):
            break
        if not blocking or asyncio.get_running_loop().time() > deadline:
            raise LockNotAcquired(key)
        await asyncio.sleep(0.05)
    try:
        yield
    finally:
        try:
            await redis.eval(_RELEASE, 1, full, token)
        except Exception:  # pragma: no cover - best effort
            pass


async def cache_get(key: str) -> Any | None:
    raw = await redis.get(f"cache:{key}")
    return orjson.loads(raw) if raw else None


async def cache_set(key: str, value: Any, ttl: int = 60) -> None:
    await redis.set(f"cache:{key}", orjson.dumps(value, default=str), ex=ttl)


async def cache_delete(*keys: str) -> None:
    if keys:
        await redis.delete(*[f"cache:{k}" for k in keys])


async def cache_delete_prefix(prefix: str) -> None:
    async for key in redis.scan_iter(match=f"cache:{prefix}*", count=500):
        await redis.delete(key)
