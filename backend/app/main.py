"""FastAPI application factory."""

from __future__ import annotations

import ipaddress
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routers import (
    admins,
    analytics,
    auth,
    broadcasts,
    catalog,
    content,
    customers,
    inventory,
    marketing,
    media,
    notifications,
    orders,
    payments,
    support,
    system,
    webhooks,
)
from app.api.routers import (
    settings as settings_router,
)
from app.core.config import settings
from app.core.context import request_id, request_ip, request_user_agent
from app.core.errors import AppError
from app.core.logging import get_logger, setup_logging
from app.security.ratelimit import hit

log = get_logger("api")
_TRUSTED = [ipaddress.ip_network(n, strict=False) for n in settings.trusted_proxies]


def _client_ip(request: Request) -> str:
    peer = request.client.host if request.client else "0.0.0.0"
    try:
        trusted = any(ipaddress.ip_address(peer) in net for net in _TRUSTED)
    except ValueError:
        trusted = False
    if trusted:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
        if real := request.headers.get("x-real-ip"):
            return real.strip()
    return peer


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    setup_logging()
    problems = settings.validate_production()
    if problems:
        for p in problems:
            log.error("configuration_problem", problem=p)
        raise RuntimeError("Invalid production configuration: " + "; ".join(problems))
    from pathlib import Path

    Path(settings.media_root).mkdir(parents=True, exist_ok=True)
    log.info("api_started", version=settings.app_version, environment=settings.environment, bot_mode=settings.bot_mode)
    yield
    from app.bot.instance import close_bot
    from app.core.database import engine

    await close_bot()
    await engine.dispose()


def create_app() -> FastAPI:
    app = FastAPI(
        title=f"{settings.app_name} API",
        version=settings.app_version,
        description="Admin & integration API for the Nexa Telegram commerce platform.",
        docs_url=f"{settings.api_prefix}/docs",
        redoc_url=f"{settings.api_prefix}/redoc",
        openapi_url=f"{settings.api_prefix}/openapi.json",
        lifespan=lifespan,
    )

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-CSRF-Token"],
        )

    @app.middleware("http")
    async def context_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:16]
        ip = _client_ip(request)
        request.state.client_ip = ip
        request_id.set(rid)
        request_ip.set(ip)
        request_user_agent.set(request.headers.get("user-agent"))
        structlog.contextvars.bind_contextvars(request_id=rid)
        path = request.url.path
        if path.startswith(settings.api_prefix) and not path.startswith(f"{settings.api_prefix}/events") \
                and not path.startswith(f"{settings.api_prefix}/webhooks"):
            allowed, _ = await hit(f"api:{ip}", settings.api_rate_limit_per_minute, 60)
            if not allowed:
                return JSONResponse({"error": {"code": "rate_limited", "message": "Too many requests"}}, status_code=429)
        start = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            structlog.contextvars.clear_contextvars()
        elapsed = (time.perf_counter() - start) * 1000
        response.headers["X-Request-ID"] = rid
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        if settings.is_production:
            response.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        if elapsed > 1500:
            log.warning("slow_request", path=path, method=request.method, ms=round(elapsed))
        return response

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse({"error": {"code": exc.code, "message": exc.message, "details": exc.details}},
                            status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
        first = errors[0] if errors else {"field": "", "message": "Invalid input"}
        msg = f"{first['field']}: {first['message']}" if first["field"] else first["message"]
        return JSONResponse({"error": {"code": "validation_failed", "message": msg, "details": errors}}, status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def http_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return JSONResponse({"error": {"code": "http_error", "message": str(exc.detail)}}, status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled_error", path=request.url.path)
        return JSONResponse({"error": {"code": "internal_error", "message": "Something went wrong. The error has been logged.",
                                       "request_id": request_id.get()}}, status_code=500)

    p = settings.api_prefix
    for r in (auth.router, analytics.router, orders.router, catalog.router, inventory.router, customers.router,
              payments.router, marketing.router, support.router, content.router, media.router, broadcasts.router,
              notifications.router, admins.router, settings_router.router, system.router, webhooks.router):
        app.include_router(r, prefix=p)
    app.include_router(webhooks.telegram_router)

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
