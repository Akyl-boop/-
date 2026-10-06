"""System health, backups, global search and the realtime event stream (SSE)."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

import orjson
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import String, cast, func, or_, select, text

from app.api.deps import DB, Auth, Perm
from app.core.config import settings
from app.core.errors import NotFound, ValidationFailed
from app.core.events import ADMIN_CHANNEL
from app.core.queue import QUEUE_NAME, enqueue
from app.core.redis import cache_get, cache_set, redis
from app.models import InventoryItem, Order, Payment, PaymentMethod, Product, Ticket, User
from app.services.audit import audit

router = APIRouter(tags=["system"])
STARTED_AT = time.time()


async def _timed(coro: Any) -> tuple[bool, float, str | None]:
    t0 = time.perf_counter()
    try:
        await asyncio.wait_for(coro, timeout=5)
        return True, round((time.perf_counter() - t0) * 1000, 1), None
    except Exception as exc:
        return False, round((time.perf_counter() - t0) * 1000, 1), str(exc)[:200]


@router.get("/system/health")
async def health(session: DB, auth: Perm("system.view")) -> dict[str, Any]:
    db_ok, db_ms, db_err = await _timed(session.execute(text("SELECT 1")))
    r_ok, r_ms, r_err = await _timed(redis.ping())
    hb = await redis.get("worker:heartbeat")
    worker_age = time.time() - float(hb) if hb else None
    queue_len = await redis.zcard(QUEUE_NAME)
    bot: dict[str, Any] = {"configured": bool(settings.bot_token.get_secret_value()), "mode": settings.bot_mode}
    cached = await cache_get("system:bot")
    if cached:
        bot.update(cached)
    elif bot["configured"]:
        from app.bot.instance import get_bot

        info: dict[str, Any] = {}
        try:
            b = get_bot()
            t0 = time.perf_counter()
            me = await asyncio.wait_for(b.get_me(), timeout=6)
            info["telegram_ok"] = True
            info["latency_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            info["username"] = me.username
            wh = await asyncio.wait_for(b.get_webhook_info(), timeout=6)
            info["webhook"] = {"url_set": bool(wh.url), "pending_updates": wh.pending_update_count,
                               "last_error": wh.last_error_message, "last_error_date": wh.last_error_date}
        except Exception as exc:
            info["telegram_ok"] = False
            info["error"] = str(exc)[:200]
        await cache_set("system:bot", info, ttl=30)
        bot.update(info)
    methods = (await session.execute(select(PaymentMethod).where(PaymentMethod.enabled.is_(True)))).scalars().all()
    from app.services.settings import settings_store

    return {
        "version": settings.app_version, "environment": settings.environment,
        "uptime_seconds": int(time.time() - STARTED_AT),
        "database": {"ok": db_ok, "latency_ms": db_ms, "error": db_err},
        "redis": {"ok": r_ok, "latency_ms": r_ms, "error": r_err},
        "worker": {"ok": worker_age is not None and worker_age < 120, "last_heartbeat_seconds": round(worker_age, 1) if worker_age else None,
                   "queue_length": queue_len},
        "bot": bot,
        "payments": [{"code": m.code, "provider": m.provider, "ok": m.last_health_ok, "checked_at": m.last_health_at,
                      "error": m.last_health_error} for m in methods],
        "maintenance": (await settings_store.group("maintenance"))["enabled"],
    }


@router.get("/system/backups")
async def list_backups(auth: Perm("system.view")) -> list[dict[str, Any]]:
    d = Path(settings.backup_dir)
    if not d.exists():
        return []
    files = sorted(d.glob("nexa-*.dump"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [{"name": f.name, "size": f.stat().st_size, "created_at": f.stat().st_mtime} for f in files]


@router.post("/system/backups")
async def create_backup(session: DB, auth: Perm("settings.edit")) -> dict[str, str]:
    await enqueue("backup_database", _job_id=f"backup:{int(time.time() // 60)}")
    await audit(session, auth.admin, "system.backup", "Started a database backup")
    return {"status": "queued"}


@router.get("/system/backups/{name}")
async def download_backup(name: str, session: DB, auth: Perm("settings.edit")) -> FileResponse:
    if "/" in name or not name.startswith("nexa-") or not name.endswith(".dump"):
        raise ValidationFailed("Invalid backup name")
    path = Path(settings.backup_dir) / name
    if not path.is_file():
        raise NotFound("Backup not found")
    await audit(session, auth.admin, "system.backup_download", f"Downloaded backup {name}")
    return FileResponse(path, filename=name, media_type="application/octet-stream")


@router.get("/search")
async def search(q: str, session: DB, auth: Auth) -> dict[str, list[dict[str, Any]]]:
    term = q.strip()
    out: dict[str, list[dict[str, Any]]] = {"orders": [], "customers": [], "products": [], "payments": [], "tickets": [],
                                            "inventory": []}
    if len(term) < 2:
        return out
    like = f"%{term.lstrip('@')}%"
    if auth.can("orders.view"):
        rows = (await session.execute(select(Order).where(Order.number.ilike(f"%{term}%")).order_by(Order.created_at.desc()).limit(6))).scalars()
        out["orders"] = [{"id": o.id, "title": o.number, "subtitle": f"{o.user.display_name} · {o.status.value}",
                          "href": f"/orders/{o.id}"} for o in rows]
    if auth.can("customers.view"):
        conds = [User.username.ilike(like), User.first_name.ilike(like), User.last_name.ilike(like)]
        if term.isdigit():
            conds.append(User.telegram_id == int(term))
        hay = func.concat_ws(" ", User.username, User.first_name, User.last_name)
        score = func.similarity(hay, term)
        rows = (await session.execute(select(User).where(or_(*conds, score > 0.3)).order_by(score.desc()).limit(6))).scalars()
        out["customers"] = [{"id": u.id, "title": u.display_name, "subtitle": f"@{u.username}" if u.username else str(u.telegram_id),
                             "href": f"/customers/{u.id}"} for u in rows]
    if auth.can("products.view"):
        name_txt = cast(Product.name, String)
        wsim = func.word_similarity(term, name_txt)
        rows = (await session.execute(select(Product).where(Product.deleted_at.is_(None), or_(
            name_txt.ilike(like), Product.slug.ilike(like), wsim > 0.4)).order_by(wsim.desc()).limit(6))).scalars()
        out["products"] = [{"id": p.id, "title": f"{p.emoji or ''} {p.name.get('en') or next(iter(p.name.values()), '')}".strip(),
                            "subtitle": p.status.value, "href": f"/products/{p.id}"} for p in rows]
    if auth.can("payments.view"):
        rows = (await session.execute(select(Payment).where(or_(Payment.reference.ilike(f"%{term}%"), Payment.tx_hash.ilike(f"%{term}%"),
                                                                Payment.external_id == term)).limit(5))).scalars()
        out["payments"] = [{"id": str(p.id), "title": p.reference, "subtitle": f"{p.method_code} · {p.status.value}",
                            "href": f"/orders/{p.order_id}"} for p in rows]
    if auth.can("support.view"):
        rows = (await session.execute(select(Ticket).where(or_(Ticket.number.ilike(f"%{term}%"), Ticket.subject.ilike(like))).limit(5))).scalars()
        out["tickets"] = [{"id": t.id, "title": f"{t.number} · {t.subject}", "subtitle": t.status.value,
                           "href": f"/support/{t.id}"} for t in rows]
    if auth.can("inventory.view"):
        rows = (await session.execute(select(InventoryItem).where(InventoryItem.preview.ilike(f"%{term}%")).limit(5))).scalars()
        out["inventory"] = [{"id": i.id, "title": i.preview, "subtitle": f"#{i.id} · {i.status.value}",
                             "href": f"/inventory?product={i.product_id}&q={i.id}"} for i in rows]
    return out


EVENT_PERMS = {"order.created": "orders.view", "order.updated": "orders.view", "payment.updated": "payments.view",
               "ticket.created": "support.view", "ticket.message": "support.view", "ticket.updated": "support.view",
               "inventory.changed": "inventory.view", "broadcast.progress": "broadcasts.send"}


@router.get("/events")
async def events(request: Request, auth: Auth) -> StreamingResponse:
    """Server-Sent Events: realtime orders, payments, tickets, notifications, stock alerts."""
    admin = auth.admin
    perms = None if admin.is_owner else {p.code for p in admin.role.permissions}

    def allowed(evt: dict[str, Any]) -> bool:
        if perms is None:
            return True
        need = EVENT_PERMS.get(evt.get("type", ""))
        if evt.get("type") == "notification":
            need = (evt.get("data") or {}).get("permission")
        return need is None or need in perms

    async def stream() -> Any:
        pubsub = redis.pubsub()
        await pubsub.subscribe(ADMIN_CHANNEL)
        try:
            yield "retry: 3000\n\n"
            last_ping = time.monotonic()
            while True:
                if await request.is_disconnected():
                    break
                msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if msg and msg.get("type") == "message":
                    try:
                        evt = orjson.loads(msg["data"])
                    except Exception:
                        continue
                    if allowed(evt):
                        yield f"event: {evt.get('type', 'message')}\ndata: {orjson.dumps(evt).decode()}\n\n"
                if time.monotonic() - last_ping > 20:
                    await redis.set(f"admin-online:{admin.id}", "1", ex=300)
                    yield ": ping\n\n"
                    last_ping = time.monotonic()
        finally:
            await pubsub.unsubscribe(ADMIN_CHANNEL)
            await pubsub.aclose()

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"})
