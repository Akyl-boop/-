"""Public endpoints: payment provider webhooks and the Telegram webhook."""

from __future__ import annotations

import hmac
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.database import session_scope
from app.core.errors import AppError
from app.core.logging import get_logger
from app.payments import service as payments

router = APIRouter(tags=["webhooks"])
log = get_logger(__name__)


@router.post("/webhooks/payments/{provider}")
async def payment_webhook(provider: str, request: Request) -> JSONResponse:
    body = await request.body()
    if len(body) > 256 * 1024:
        return JSONResponse({"ok": False}, status_code=413)
    headers = {k.lower(): v for k, v in request.headers.items()}
    try:
        async with session_scope() as session:
            result: dict[str, Any] = await payments.handle_webhook(session, provider, headers, body)
        return JSONResponse(result)
    except AppError as exc:
        log.warning("payment_webhook_rejected", provider=provider, code=exc.code)
        return JSONResponse({"ok": False, "error": exc.code}, status_code=exc.status_code)
    except Exception:
        log.exception("payment_webhook_error", provider=provider)
        # 500 → the provider will retry later; idempotency makes retries safe.
        return JSONResponse({"ok": False}, status_code=500)


telegram_router = APIRouter(tags=["telegram"])


@telegram_router.post("/telegram/webhook")
async def telegram_webhook(request: Request) -> JSONResponse:
    expected = settings.telegram_webhook_secret.get_secret_value()
    got = request.headers.get("x-telegram-bot-api-secret-token", "")
    if not expected or not hmac.compare_digest(expected, got):
        return JSONResponse({"ok": False}, status_code=401)
    from aiogram.types import Update

    from app.bot.factory import build_dispatcher
    from app.bot.instance import get_bot

    data = await request.json()
    update = Update.model_validate(data, context={"bot": get_bot()})
    try:
        await build_dispatcher().feed_update(get_bot(), update)
    except Exception:
        log.exception("telegram_update_failed")
    return JSONResponse({"ok": True})
