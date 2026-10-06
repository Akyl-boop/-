"""Async SQLAlchemy engine, session factory and after-commit hooks."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.database_echo,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_pre_ping=True,
    pool_recycle=1800,
)

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)

AfterCommit = Callable[[], Awaitable[None]]


def on_commit(session: AsyncSession, callback: AfterCommit) -> None:
    """Register a coroutine factory to run after the surrounding unit of work commits.

    Used for side effects that must only happen once data is durable: publishing
    realtime events, enqueueing background jobs, invalidating caches, sending Telegram messages.
    """
    session.info.setdefault("after_commit", []).append(callback)


async def run_after_commit(session: AsyncSession) -> None:
    from app.core.logging import get_logger

    callbacks: list[AfterCommit] = session.info.pop("after_commit", [])
    for cb in callbacks:
        try:
            await cb()
        except Exception as exc:  # side effects must never break the request
            get_logger(__name__).exception("after_commit_hook_failed", error=str(exc))


async def commit(session: AsyncSession) -> None:
    """Commit and run after-commit hooks (use instead of session.commit())."""
    await session.commit()
    await run_after_commit(session)


@asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    """Unit-of-work scope: commits on success (then runs hooks), rolls back on error."""
    async with SessionLocal() as session:
        try:
            yield session
            await commit(session)
        except Exception:
            session.info.pop("after_commit", None)
            await session.rollback()
            raise


async def get_session() -> AsyncIterator[AsyncSession]:
    async with session_scope() as session:
        yield session
