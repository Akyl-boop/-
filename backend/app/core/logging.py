"""Structured logging (structlog) with secret redaction."""

from __future__ import annotations

import logging
import re
import sys
from typing import Any

import structlog

from app.core.config import settings

_SENSITIVE_KEYS = re.compile(
    r"(pass(word)?|secret|token|api[_-]?key|private|authorization|cookie|totp|credential|signature|content)",
    re.IGNORECASE,
)
_BOT_TOKEN_RE = re.compile(r"\d{6,12}:[A-Za-z0-9_-]{30,}")


def _redact(value: Any, depth: int = 0) -> Any:
    if depth > 4:
        return value
    if isinstance(value, dict):
        return {
            k: ("***" if isinstance(k, str) and _SENSITIVE_KEYS.search(k) else _redact(v, depth + 1))
            for k, v in value.items()
        }
    if isinstance(value, list | tuple):
        return [_redact(v, depth + 1) for v in value]
    if isinstance(value, str):
        return _BOT_TOKEN_RE.sub("<bot-token>", value)
    return value


def redact_processor(_logger: Any, _name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
    for key in list(event_dict.keys()):
        if key in ("event", "level", "timestamp", "logger"):
            if isinstance(event_dict[key], str):
                event_dict[key] = _BOT_TOKEN_RE.sub("<bot-token>", event_dict[key])
            continue
        if _SENSITIVE_KEYS.search(key):
            event_dict[key] = "***"
        else:
            event_dict[key] = _redact(event_dict[key])
    return event_dict


def setup_logging() -> None:
    level = getattr(logging, settings.log_level.upper(), logging.INFO)
    shared: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        redact_processor,
    ]
    renderer: Any = (
        structlog.processors.JSONRenderer()
        if settings.log_json
        else structlog.dev.ConsoleRenderer(colors=sys.stderr.isatty())
    )
    structlog.configure(
        processors=[*shared, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    formatter = structlog.stdlib.ProcessorFormatter(
        foreign_pre_chain=shared,
        processors=[structlog.stdlib.ProcessorFormatter.remove_processors_meta, structlog.processors.format_exc_info, renderer],
    )
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    for noisy in ("uvicorn.access", "aiogram.event", "httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
