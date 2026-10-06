"""Redis-backed fixed-window rate limiter."""

from __future__ import annotations

import time

from app.core.errors import RateLimited
from app.core.redis import redis


async def hit(key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
    """Register a hit. Returns (allowed, remaining)."""
    bucket = int(time.time() // window_seconds)
    full = f"rl:{key}:{bucket}"
    pipe = redis.pipeline()
    pipe.incr(full)
    pipe.expire(full, window_seconds + 1)
    count, _ = await pipe.execute()
    return count <= limit, max(0, limit - count)


async def enforce(key: str, limit: int, window_seconds: int, message: str = "Too many requests") -> None:
    allowed, _ = await hit(key, limit, window_seconds)
    if not allowed:
        raise RateLimited(message)
