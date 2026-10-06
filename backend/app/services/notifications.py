"""Admin notifications: dashboard notification center, Telegram, e-mail and webhook channels."""

from __future__ import annotations

import hashlib
import hmac
from email.message import EmailMessage
from typing import Any

import httpx
import orjson
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import SessionLocal, on_commit
from app.core.events import publish_admin_event
from app.core.logging import get_logger
from app.core.queue import enqueue
from app.core.redis import redis
from app.models import Admin, Notification
from app.security.html import html_to_plain
from app.services.settings import NOTIFICATION_TYPES, settings_store

log = get_logger(__name__)

SEVERITY = {
    "new_order": "info", "payment_received": "success", "large_payment": "success", "payment_failed": "warning",
    "refund": "warning", "low_stock": "warning", "out_of_stock": "critical", "new_customer": "info",
    "new_ticket": "info", "ticket_message": "info", "manual_delivery": "warning", "suspicious": "critical",
    "error": "critical",
}
PERMISSION = {
    "new_order": "orders.view", "payment_received": "payments.view", "large_payment": "payments.view",
    "payment_failed": "payments.view", "refund": "orders.view", "low_stock": "inventory.view",
    "out_of_stock": "inventory.view", "new_customer": "customers.view", "new_ticket": "support.view",
    "ticket_message": "support.view", "manual_delivery": "orders.manage", "suspicious": "audit.view",
    "error": "system.view",
}


async def notify(
    session: AsyncSession,
    type_: str,
    title: str,
    body: str | None = None,
    *,
    link: str | None = None,
    data: dict[str, Any] | None = None,
    telegram_vars: dict[str, Any] | None = None,
    dedupe_key: str | None = None,
    dedupe_ttl: int = 3600,
) -> Notification | None:
    """Create an admin notification. Channels are dispatched after the transaction commits."""
    if type_ not in NOTIFICATION_TYPES:
        raise ValueError(type_)
    if not await settings_store.feature("notifications"):
        return None
    rule = (await settings_store.group("notifications"))["rules"].get(type_, {})
    if not rule.get("enabled", True):
        return None
    if dedupe_key and not await redis.set(f"notif-dedupe:{type_}:{dedupe_key}", "1", nx=True, ex=dedupe_ttl):
        return None

    n = Notification(
        type=type_, severity=SEVERITY.get(type_, "info"), title=title[:200], body=(body or "")[:1000] or None,
        link=link, data=data, permission=PERMISSION.get(type_),
    )
    if rule.get("dashboard", True):
        session.add(n)
        await session.flush()

    async def _after() -> None:
        if rule.get("dashboard", True):
            await publish_admin_event(
                "notification",
                {"id": n.id, "type": type_, "severity": n.severity, "title": n.title, "body": n.body, "link": link,
                 "permission": n.permission},
            )
        if any(rule.get(ch) for ch in ("telegram", "email", "webhook")):
            await enqueue("deliver_admin_notification", type_, title, body or "", link, telegram_vars or {}, data or {})

    on_commit(session, _after)
    return n


async def deliver_external(type_: str, title: str, body: str, link: str | None, tg_vars: dict[str, Any],
                           data: dict[str, Any]) -> None:
    """Executed by the worker: deliver a notification to Telegram / e-mail / webhook."""
    cfg = await settings_store.group("notifications")
    rule = cfg["rules"].get(type_, {})
    url = f"{settings.public_url.rstrip('/')}{link}" if link else None

    if rule.get("telegram"):
        await _send_telegram(type_, title, body, url, tg_vars, cfg.get("telegram_chat_ids") or [])
    if rule.get("email") and cfg.get("email_recipients"):
        await send_email(cfg["email_recipients"], f"[{(await settings_store.get('general.store_name'))}] {title}",
                         f"{body}\n\n{url or ''}")
    if rule.get("webhook") and cfg.get("webhook_url"):
        await _post_webhook(cfg["webhook_url"], {"type": type_, "title": title, "body": body, "link": url, "data": data})


async def _send_telegram(type_: str, title: str, body: str, url: str | None, tg_vars: dict[str, Any],
                         extra_chats: list[Any]) -> None:
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

    from app.bot.instance import bot_configured, get_bot
    from app.services.texts import t

    if not bot_configured():
        return
    perm = PERMISSION.get(type_)
    async with SessionLocal() as s:
        admins = (
            await s.execute(
                select(Admin).where(
                    Admin.is_active.is_(True), Admin.telegram_id.is_not(None),
                    Admin.receive_telegram_notifications.is_(True),
                )
            )
        ).scalars().all()
    chat_ids: set[Any] = {a.telegram_id for a in admins if not perm or a.has_permission(perm)}
    chat_ids.update(c for c in extra_chats if c)
    if not chat_ids:
        return
    key = f"admin.{type_}"
    try:
        text = await t(key, "en", **tg_vars) if tg_vars else f"<b>{title}</b>\n{body}"
    except Exception:
        text = f"<b>{title}</b>\n{body}"
    markup = None
    if url and url.startswith("https://"):
        markup = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text="Open in dashboard ↗", url=url)]])
    bot = get_bot()
    for chat_id in chat_ids:
        try:
            await bot.send_message(chat_id, text[:4096], reply_markup=markup)
        except Exception as exc:
            log.warning("admin_telegram_notification_failed", chat_id=chat_id, error=str(exc))


async def send_email(recipients: list[str], subject: str, body: str) -> bool:
    if not settings.smtp_host:
        log.info("email_skipped_no_smtp", subject=subject)
        return False
    import aiosmtplib

    msg = EmailMessage()
    msg["From"] = settings.smtp_from
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.set_content(html_to_plain(body))
    try:
        await aiosmtplib.send(
            msg, hostname=settings.smtp_host, port=settings.smtp_port, username=settings.smtp_username,
            password=settings.smtp_password.get_secret_value() if settings.smtp_password else None,
            start_tls=settings.smtp_starttls, timeout=15,
        )
        return True
    except Exception as exc:
        log.error("email_send_failed", error=str(exc))
        return False


async def _post_webhook(url: str, payload: dict[str, Any]) -> None:
    body = orjson.dumps(payload, default=str)
    sig = hmac.new(settings.secret_key.get_secret_value().encode(), body, hashlib.sha256).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, content=body, headers={"Content-Type": "application/json", "X-Nexa-Signature": sig})
    except Exception as exc:
        log.warning("notification_webhook_failed", error=str(exc))
