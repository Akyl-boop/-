"""Background job queue (arq on Redis)."""

from __future__ import annotations

from typing import Any

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings

from app.core.config import settings
from app.core.logging import get_logger

log = get_logger(__name__)
_pool: ArqRedis | None = None

QUEUE_NAME = "nexa:queue"


def redis_settings() -> RedisSettings:
    return RedisSettings.from_dsn(settings.redis_url)


async def get_pool() -> ArqRedis:
    global _pool
    if _pool is None:
        _pool = await create_pool(redis_settings(), default_queue_name=QUEUE_NAME)
    return _pool


async def enqueue(function: str, *args: Any, _job_id: str | None = None, _defer_by: float | None = None,
                  **kwargs: Any) -> bool:
    """Enqueue a job. Returns False if a job with the same id is already queued (dedupe)."""
    try:
        pool = await get_pool()
        job = await pool.enqueue_job(function, *args, _job_id=_job_id, _defer_by=_defer_by, **kwargs)
        return job is not None
    except Exception as exc:
        log.error("enqueue_failed", function=function, error=str(exc))
        return False
