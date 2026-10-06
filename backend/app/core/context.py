"""Request-scoped context (client IP / user agent) for audit logs and structured logging."""

from contextvars import ContextVar

request_ip: ContextVar[str | None] = ContextVar("request_ip", default=None)
request_user_agent: ContextVar[str | None] = ContextVar("request_user_agent", default=None)
request_id: ContextVar[str | None] = ContextVar("request_id", default=None)
