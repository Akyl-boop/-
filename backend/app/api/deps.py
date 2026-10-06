"""API dependencies: DB session, authentication, RBAC, CSRF, pagination."""

from __future__ import annotations

import hmac
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated, Any

from fastapi import Depends, Query, Request
from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import sha256_hex
from app.core.database import session_scope
from app.core.errors import Forbidden, Unauthorized
from app.core.redis import redis
from app.core.utils import utcnow
from app.models import Admin, AdminSession

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


async def db() -> AsyncIterator[AsyncSession]:
    async with session_scope() as session:
        yield session


DB = Annotated[AsyncSession, Depends(db)]


def client_ip(request: Request) -> str:
    return getattr(request.state, "client_ip", None) or (request.client.host if request.client else "unknown")


@dataclass
class AuthContext:
    admin: Admin
    session: AdminSession

    def can(self, perm: str) -> bool:
        return self.admin.has_permission(perm)


async def _load_session(session: AsyncSession, token: str) -> AdminSession | None:
    s = (
        await session.execute(select(AdminSession).where(AdminSession.token_hash == sha256_hex(token)))
    ).scalar_one_or_none()
    now = utcnow()
    if s is None or s.revoked_at is not None or s.expires_at <= now:
        return None
    if now - s.last_seen_at > timedelta(hours=settings.session_idle_timeout_hours):
        return None
    return s


def verify_csrf(request: Request) -> None:
    if request.method in SAFE_METHODS:
        return
    cookie = request.cookies.get(settings.csrf_cookie_name)
    header = request.headers.get("x-csrf-token")
    if not cookie or not header or not hmac.compare_digest(cookie, header):
        raise Forbidden("CSRF token missing or invalid", code="csrf_failed")


async def current_auth(request: Request, session: DB) -> AuthContext:
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise Unauthorized("Not authenticated")
    s = await _load_session(session, token)
    if s is None or not s.admin.is_active:
        raise Unauthorized("Session expired")
    verify_csrf(request)
    now = utcnow()
    # Throttle last-seen writes to once per minute
    if (now - s.last_seen_at).total_seconds() > 60:
        s.last_seen_at = now
    request.state.admin_id = s.admin_id
    return AuthContext(admin=s.admin, session=s)


Auth = Annotated[AuthContext, Depends(current_auth)]


def require(*perms: str) -> Callable[..., Any]:
    async def checker(auth: Auth) -> AuthContext:
        missing = [p for p in perms if not auth.can(p)]
        if missing:
            raise Forbidden(f"Missing permission: {', '.join(missing)}")
        return auth

    return checker


def Perm(*perms: str) -> Any:  # noqa: N802 - reads naturally in signatures
    return Annotated[AuthContext, Depends(require(*perms))]


@dataclass
class Page:
    page: int
    page_size: int

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size


def pagination(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=200)) -> Page:
    return Page(page, page_size)


Paging = Annotated[Page, Depends(pagination)]


async def paginate(session: AsyncSession, query: Select, page: Page, *, scalars: bool = True) -> tuple[list[Any], int]:
    total = (await session.execute(select(func.count()).select_from(query.order_by(None).subquery()))).scalar_one()
    result = await session.execute(query.offset(page.offset).limit(page.page_size))
    items = list(result.scalars().unique()) if scalars else list(result.all())
    return items, int(total)


def page_response(items: list[Any], total: int, page: Page) -> dict[str, Any]:
    return {"items": items, "total": total, "page": page.page, "page_size": page.page_size,
            "pages": max(1, -(-total // page.page_size))}


async def mark_activity(admin_id: int) -> None:
    await redis.set(f"admin-online:{admin_id}", "1", ex=300)
