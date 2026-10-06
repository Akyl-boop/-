"""Background worker (arq): fulfillment, payment polling, expiry, broadcasts, notifications, webhooks, backups.

Run with:  arq app.workers.main.WorkerSettings
"""

from __future__ import annotations

import asyncio
import time
from datetime import timedelta
from typing import Any

from arq import Retry, cron
from sqlalchemy import delete, select, update

from app.core.config import settings
from app.core.database import session_scope
from app.core.logging import get_logger, setup_logging
from app.core.queue import QUEUE_NAME, redis_settings
from app.core.redis import LockNotAcquired, redis, redis_lock
from app.core.utils import utcnow
from app.models import AdminSession, Broadcast, Order, Payment, PaymentMethod, Product, WebhookEvent
from app.models.enums import BroadcastStatus, OrderStatus, PaymentStatus

log = get_logger("worker")


# ─── Jobs ───────────────────────────────────────────────────────────────────


async def fulfill_order(ctx: dict[str, Any], order_id: int) -> dict[str, Any]:
    from app.fulfillment.service import fulfill_order as run

    return await run(order_id)


async def deliver_admin_notification(ctx: dict[str, Any], type_: str, title: str, body: str, link: str | None,
                                     tg_vars: dict[str, Any], data: dict[str, Any]) -> None:
    from app.services.notifications import deliver_external

    await deliver_external(type_, title, body, link, tg_vars, data)


async def deliver_webhook(ctx: dict[str, Any], delivery_id: str) -> None:
    from app.services.webhooks_out import deliver

    done = await deliver(delivery_id)
    if not done:
        tries = ctx.get("job_try", 1)
        raise Retry(defer=min(3600, 15 * (2 ** tries)))


async def run_broadcast(ctx: dict[str, Any], broadcast_id: int) -> None:
    from app.services.broadcasts import run_broadcast as run

    await run(broadcast_id)


async def notify_restock(ctx: dict[str, Any], product_id: int) -> int:
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

    from app.bot.callbacks import Prod
    from app.bot.notify import send_text
    from app.core.utils import i18n_get
    from app.models import RestockSubscription, User
    from app.services.catalog import product_stock, stock_map
    from app.services.texts import btn, t

    async with session_scope() as s:
        product = await s.get(Product, product_id)
        if product is None:
            return 0
        stock = product_stock(product, await stock_map(s, [product]))
        if stock == 0:
            return 0
        subs = (await s.execute(select(RestockSubscription, User).join(User, User.id == RestockSubscription.user_id)
                                .where(RestockSubscription.product_id == product_id))).all()
        targets = [(u.telegram_id, u.language) for _, u in subs]
        await s.execute(delete(RestockSubscription).where(RestockSubscription.product_id == product_id))
        names = product.name
    for tg_id, lang in targets:
        markup = InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(
            text=await btn("btn.buy_now", lang), callback_data=Prod(id=product_id).pack())]])
        await send_text(tg_id, await t("notify.restock", lang, product=i18n_get(names, lang)), markup)
        await asyncio.sleep(0.05)
    return len(targets)


async def check_low_stock_for_order(ctx: dict[str, Any], order_id: int) -> None:
    from app.services.inventory import check_low_stock

    async with session_scope() as s:
        order = await s.get(Order, order_id)
        if order is not None:
            await check_low_stock(s, [i.product_id for i in order.items if i.product_id])


async def backup_database(ctx: dict[str, Any]) -> str:
    from datetime import datetime
    from pathlib import Path

    from app.cli import _pg_env

    Path(settings.backup_dir).mkdir(parents=True, exist_ok=True)
    out = Path(settings.backup_dir) / f"nexa-{datetime.now():%Y%m%d-%H%M%S}.dump"
    args, env = _pg_env()
    proc = await asyncio.create_subprocess_exec("pg_dump", "-Fc", "--no-owner", "-f", str(out), *args[:-1], args[-1],
                                                env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0:
        log.error("backup_failed", error=err.decode()[:500])
        raise RuntimeError("pg_dump failed")
    await redis.set("backup:last", str(time.time()))
    # retention
    from app.services.settings import settings_store

    days = int((await settings_store.group("backups")).get("retention_days") or 14)
    cutoff = time.time() - days * 86400
    for f in Path(settings.backup_dir).glob("nexa-*.dump"):
        if f.stat().st_mtime < cutoff:
            f.unlink(missing_ok=True)
    log.info("backup_created", file=str(out))
    return str(out)


# ─── Periodic tasks ─────────────────────────────────────────────────────────


async def heartbeat(ctx: dict[str, Any]) -> None:
    await redis.set("worker:heartbeat", str(time.time()), ex=600)


async def poll_payments(ctx: dict[str, Any]) -> int:
    """Poll pending payments of pollable providers (crypto, CryptoBot fallback for missed webhooks)."""
    from app.payments import service as payments
    from app.payments.base import ProviderUnavailable

    try:
        async with redis_lock("cron:poll_payments", ttl=55):
            async with session_scope() as s:
                rows = (await s.execute(
                    select(Payment.id, Payment.last_checked_at, Payment.created_at).where(
                        Payment.status.in_([PaymentStatus.PENDING, PaymentStatus.AWAITING_CONFIRMATION]),
                        Payment.provider.in_(["crypto_direct", "cryptobot"]),
                        Payment.created_at > utcnow() - timedelta(days=2),
                    ).order_by(Payment.last_checked_at.nulls_first()).limit(60)
                )).all()
            checked = 0
            now = utcnow()
            for pid, last, created in rows:
                age = (now - created).total_seconds()
                interval = 20 if age < 1800 else 120  # back off for older payments
                if last and (now - last).total_seconds() < interval:
                    continue
                try:
                    async with session_scope() as s:
                        await payments.refresh_payment(s, pid)
                    checked += 1
                except ProviderUnavailable as exc:
                    log.info("poll_provider_unavailable", payment_id=str(pid), error=str(exc)[:200])
                    async with session_scope() as s:
                        await s.execute(update(Payment).where(Payment.id == pid).values(last_checked_at=utcnow()))
                except Exception:
                    log.exception("poll_payment_failed", payment_id=str(pid))
                await asyncio.sleep(0.2)
            return checked
    except LockNotAcquired:
        return 0


async def expire_orders(ctx: dict[str, Any]) -> int:
    from app.bot.notify import send_payment_expired
    from app.payments import service as payments

    try:
        async with redis_lock("cron:expire_orders", ttl=55):
            async with session_scope() as s:
                expired = await payments.expire_overdue(s)
            for oid in expired:
                await send_payment_expired(oid)
            if expired:
                from app.core.events import publish_admin_event

                await publish_admin_event("order.updated", {"ids": expired, "status": "expired"})
            return len(expired)
    except LockNotAcquired:
        return 0


async def retry_stuck_fulfillment(ctx: dict[str, Any]) -> int:
    """Safety net: paid orders whose fulfillment job was lost get fulfilled again (idempotent)."""
    from app.fulfillment.service import fulfill_order as run

    async with session_scope() as s:
        ids = list((await s.execute(select(Order.id).where(
            Order.status == OrderStatus.PAID, Order.paid_at < utcnow() - timedelta(minutes=2),
            Order.paid_at > utcnow() - timedelta(days=3)).limit(20))).scalars())
    for oid in ids:
        await run(oid)
    return len(ids)


async def scheduled_broadcasts(ctx: dict[str, Any]) -> int:
    from app.core.queue import enqueue

    async with session_scope() as s:
        due = list((await s.execute(select(Broadcast.id).where(
            Broadcast.status == BroadcastStatus.SCHEDULED, Broadcast.scheduled_at <= utcnow()))).scalars())
        resumable = list((await s.execute(select(Broadcast.id).where(Broadcast.status == BroadcastStatus.SENDING))).scalars())
    for bid in due + resumable:
        await enqueue("run_broadcast", bid, _job_id=f"broadcast:{bid}")
    return len(due)


async def payment_health(ctx: dict[str, Any]) -> None:
    from app.payments.registry import PROVIDERS, build_provider

    async with session_scope() as s:
        methods = (await s.execute(select(PaymentMethod).where(PaymentMethod.enabled.is_(True)))).scalars().all()
        for m in methods:
            if m.provider not in PROVIDERS:
                continue
            p = build_provider(m)
            try:
                ok, msg = await asyncio.wait_for(p.health_check(), timeout=15)
            except Exception as exc:
                ok, msg = False, str(exc)[:300]
            if m.last_health_ok and not ok:
                from app.services.notifications import notify

                await notify(s, "payment_failed", f"Payment method {m.code} is unhealthy", msg,
                             link="/payments/methods", telegram_vars={"order": m.code, "reason": msg},
                             dedupe_key=f"health:{m.code}", dedupe_ttl=3600)
            m.last_health_ok, m.last_health_at, m.last_health_error = ok, utcnow(), None if ok else msg


async def auto_backup(ctx: dict[str, Any]) -> None:
    from app.services.settings import settings_store

    cfg = await settings_store.group("backups")
    if not cfg.get("enabled"):
        return
    last = float(await redis.get("backup:last") or 0)
    if time.time() - last >= int(cfg.get("interval_hours") or 24) * 3600:
        await backup_database(ctx)


async def cleanup(ctx: dict[str, Any]) -> None:
    async with session_scope() as s:
        await s.execute(delete(WebhookEvent).where(WebhookEvent.created_at < utcnow() - timedelta(days=90)))
        await s.execute(delete(AdminSession).where(AdminSession.expires_at < utcnow() - timedelta(days=30)))


async def startup(ctx: dict[str, Any]) -> None:
    setup_logging()
    await heartbeat(ctx)
    log.info("worker_started")


async def shutdown(ctx: dict[str, Any]) -> None:
    from app.bot.instance import close_bot

    await close_bot()


class WorkerSettings:
    functions = [fulfill_order, deliver_admin_notification, deliver_webhook, run_broadcast, notify_restock,
                 check_low_stock_for_order, backup_database]
    cron_jobs = [
        cron(heartbeat, second={0, 30}, run_at_startup=True),
        cron(poll_payments, second={5, 25, 45}),
        cron(expire_orders, second={10}),
        cron(retry_stuck_fulfillment, minute=set(range(0, 60, 2)), second={40}),
        cron(scheduled_broadcasts, second={15}),
        cron(payment_health, minute={7, 17, 27, 37, 47, 57}, second={0}),
        cron(auto_backup, minute={3}, second={0}),
        cron(cleanup, hour={4}, minute={13}, second={0}),
    ]
    redis_settings = redis_settings()
    queue_name = QUEUE_NAME
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 20
    job_timeout = 3600
    max_tries = 8
    keep_result = 3600
