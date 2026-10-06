"""Audit logging of administrative actions."""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.context import request_ip, request_user_agent
from app.models import Admin, AuditLog

_REDACT = {"password", "password_hash", "secret", "secret_config", "secret_config_enc", "content", "content_enc",
           "totp_secret_enc", "api_token", "token", "provider_token", "private_key"}


def _jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: ("***" if k in _REDACT else _jsonable(v)) for k, v in value.items()}
    if isinstance(value, list | tuple | set):
        return [_jsonable(v) for v in value]
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, Enum):
        return value.value
    return value


def diff(old: dict[str, Any], new: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Return only changed keys."""
    o, n = {}, {}
    for k in set(old) | set(new):
        if _jsonable(old.get(k)) != _jsonable(new.get(k)):
            o[k], n[k] = old.get(k), new.get(k)
    return _jsonable(o), _jsonable(n)


def snapshot(obj: Any, fields: list[str]) -> dict[str, Any]:
    return {f: getattr(obj, f, None) for f in fields}


async def audit(
    session: AsyncSession,
    admin: Admin | None,
    action: str,
    summary: str,
    *,
    entity_type: str | None = None,
    entity_id: Any = None,
    old: Any = None,
    new: Any = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> AuditLog:
    log = AuditLog(
        admin_id=admin.id if admin else None,
        admin_email=admin.email if admin else None,
        action=action,
        summary=summary[:500],
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        old_value=_jsonable(old),
        new_value=_jsonable(new),
        ip=ip or request_ip.get(),
        user_agent=(user_agent or request_user_agent.get() or "")[:500] or None,
    )
    session.add(log)
    return log
