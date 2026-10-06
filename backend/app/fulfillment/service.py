"""Order fulfillment orchestration (idempotent, safe to retry)."""

from __future__ import annotations

from typing import Any

import orjson
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_str, encrypt_str
from app.core.database import on_commit, session_scope
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.events import publish_admin_event
from app.core.logging import get_logger
from app.core.redis import LockNotAcquired, redis_lock
from app.core.utils import utcnow
from app.fulfillment.handlers import FULFILLERS, DeliveredUnit, FulfillContext
from app.models import Admin, Order, OrderItem, Product, ProductVariant
from app.models.enums import DeliveryMode, DeliveryStatus, OrderStatus
from app.services.customers import add_event
from app.services.notifications import notify
from app.services.orders import add_order_event, lock_order

log = get_logger(__name__)

FULFILLABLE = (OrderStatus.PAID, OrderStatus.PROCESSING)


def delivered_units(item: OrderItem) -> list[dict[str, Any]]:
    if not item.delivery_data_enc:
        return []
    try:
        return orjson.loads(decrypt_str(item.delivery_data_enc) or "[]")
    except Exception:
        return []


def _store_units(item: OrderItem, units: list[DeliveredUnit]) -> None:
    existing = delivered_units(item)
    existing.extend(u.to_dict() for u in units)
    item.delivery_data_enc = encrypt_str(orjson.dumps(existing).decode())


async def fulfill_order(order_id: int) -> dict[str, Any]:
    """Deliver everything that can be delivered automatically. Returns a summary."""
    try:
        async with redis_lock(f"fulfill:{order_id}", ttl=120, blocking=True, wait=30):
            async with session_scope() as session:
                return await _fulfill(session, order_id)
    except LockNotAcquired:
        log.warning("fulfill_lock_busy", order_id=order_id)
        return {"status": "busy"}


async def _fulfill(session: AsyncSession, order_id: int) -> dict[str, Any]:
    order = await lock_order(session, order_id)
    if order is None:
        raise NotFound("Order not found")
    if order.status not in FULFILLABLE:
        return {"status": "skipped", "reason": order.status.value}

    delivered_item_ids: list[int] = []
    waiting_items: list[OrderItem] = []
    errors: list[str] = []
    product_ids = [i.product_id for i in order.items if i.product_id]
    products = {p.id: p for p in (await session.execute(select(Product).where(Product.id.in_(product_ids or [0])))).scalars()}
    variant_ids = [i.variant_id for i in order.items if i.variant_id]
    variants = {v.id: v for v in (await session.execute(
        select(ProductVariant).where(ProductVariant.id.in_(variant_ids or [0])))).scalars()}

    for item in order.items:
        remaining = item.quantity - item.delivered_quantity
        if remaining <= 0:
            continue
        product = products.get(item.product_id or 0)
        variant = variants.get(item.variant_id or 0)
        config = dict(product.fulfillment_config or {}) if product else {}
        if variant and variant.fulfillment_config:
            config.update(variant.fulfillment_config)
        fulfiller = FULFILLERS[item.delivery_mode]
        ctx = FulfillContext(session=session, order=order, item=item, product=product, variant=variant,
                             config=config, lang=order.language, remaining=remaining)
        try:
            result = await fulfiller.fulfill(ctx)
        except Exception as exc:  # never leave the order in limbo because of one handler
            log.exception("fulfiller_crashed", order=order.number, item=item.id)
            result = type("R", (), {"units": [], "quantity": 0, "waiting": False, "error": str(exc)[:300]})()
        if result.units:
            _store_units(item, result.units)
        if result.quantity:
            item.delivered_quantity = min(item.quantity, item.delivered_quantity + result.quantity)
            item.delivered_at = utcnow()
            delivered_item_ids.append(item.id)
            await add_order_event(session, order.id, "delivered",
                                  f"Delivered {result.quantity} × {item.product_name}" + (
                                      f" ({item.variant_name})" if item.variant_name else ""),
                                  data={"order_item_id": item.id, "mode": item.delivery_mode.value})
        if result.error:
            errors.append(f"{item.product_name}: {result.error}")
            await add_order_event(session, order.id, "delivery_failed", result.error,
                                  data={"order_item_id": item.id})
        if item.delivered_quantity < item.quantity and (result.waiting or result.error):
            waiting_items.append(item)

    all_done = all(i.delivered_quantity >= i.quantity for i in order.items)
    any_done = any(i.delivered_quantity > 0 for i in order.items)
    now = utcnow()
    if all_done:
        order.status = OrderStatus.COMPLETED
        order.delivery_status = DeliveryStatus.DELIVERED
        order.delivered_at = order.delivered_at or now
        order.completed_at = now
        await add_order_event(session, order.id, "completed", "Order completed")
        await add_event(session, order.user_id, "delivered", f"Order {order.number} delivered", {"order_id": order.id})
    else:
        order.status = OrderStatus.PROCESSING
        manual_only = all(i.delivery_mode in (DeliveryMode.MANUAL, DeliveryMode.WEBHOOK) for i in waiting_items) and not errors
        order.delivery_status = DeliveryStatus.PARTIAL if any_done else (
            DeliveryStatus.MANUAL if manual_only else DeliveryStatus.FAILED)
        lines = "\n".join(f"• {i.product_name} × {i.quantity - i.delivered_quantity}" for i in waiting_items)
        if errors:
            await notify(session, "manual_delivery", f"Delivery needs attention · {order.number}",
                         "\n".join(errors)[:900], link=f"/orders/{order.id}",
                         telegram_vars={"order": order.number, "items": lines + "\n" + "\n".join(errors)[:500]},
                         dedupe_key=f"{order.id}:err", dedupe_ttl=1800)
        elif waiting_items and any(i.delivery_mode == DeliveryMode.MANUAL for i in waiting_items):
            await notify(session, "manual_delivery", f"Manual delivery required · {order.number}", lines,
                         link=f"/orders/{order.id}", telegram_vars={"order": order.number, "items": lines},
                         dedupe_key=f"{order.id}:manual", dedupe_ttl=86400)

    from app.services.inventory import check_low_stock

    await check_low_stock(session, product_ids)

    status = order.status.value
    oid = order.id
    notify_manual = bool(waiting_items) and not delivered_item_ids
    has_errors = bool(errors)

    async def _after() -> None:
        from app.bot.notify import send_order_delivery, send_order_waiting

        await publish_admin_event("order.updated", {"id": oid, "status": status})
        if delivered_item_ids:
            await send_order_delivery(oid, delivered_item_ids)
        if notify_manual:
            await send_order_waiting(oid, failed=has_errors)
        if status == OrderStatus.COMPLETED.value:
            from app.services.webhooks_out import dispatch

            await dispatch("order.completed", {"order_id": oid})

    on_commit(session, _after)
    return {"status": status, "delivered_items": delivered_item_ids, "errors": errors}


async def deliver_manually(session: AsyncSession, order_item_id: int, contents: list[str], admin: Admin | None,
                           *, source: str = "admin") -> Order:
    """Deliver goods for an order item by hand (dashboard) or via a signed fulfillment callback."""
    item = await session.get(OrderItem, order_item_id)
    if item is None:
        raise NotFound("Order item not found")
    order = await lock_order(session, item.order_id)
    assert order is not None
    if order.status not in FULFILLABLE and order.status != OrderStatus.COMPLETED:
        raise Conflict("Order is not paid")
    contents = [c.strip() for c in contents if c and c.strip()]
    if not contents:
        raise ValidationFailed("Nothing to deliver")
    units = [DeliveredUnit(type="text", value=c[:4000]) for c in contents]
    _store_units(item, units)
    if source == "admin":
        # An administrator's manual delivery satisfies the whole line.
        item.delivered_quantity = item.quantity
    else:
        item.delivered_quantity = min(item.quantity, item.delivered_quantity + len(contents))
    item.delivered_at = utcnow()
    await add_order_event(session, order.id, "delivered", f"Delivered manually: {item.product_name}",
                          actor="admin" if admin else "system", admin_id=admin.id if admin else None,
                          data={"order_item_id": item.id, "source": source})
    if all(i.delivered_quantity >= i.quantity for i in order.items):
        order.status = OrderStatus.COMPLETED
        order.delivery_status = DeliveryStatus.DELIVERED
        order.delivered_at = order.completed_at = utcnow()
        await add_order_event(session, order.id, "completed", "Order completed")
    else:
        order.delivery_status = DeliveryStatus.PARTIAL
    oid, iid, status = order.id, item.id, order.status.value

    async def _after() -> None:
        from app.bot.notify import send_order_delivery

        await send_order_delivery(oid, [iid])
        await publish_admin_event("order.updated", {"id": oid, "status": status})

    on_commit(session, _after)
    return order


async def resend(order_id: int) -> int:
    from app.bot.notify import send_order_delivery

    async with session_scope() as session:
        order = await session.get(Order, order_id)
        if order is None:
            raise NotFound("Order not found")
        ids = [i.id for i in order.items if i.delivered_quantity > 0]
        if not ids:
            raise ValidationFailed("Nothing has been delivered yet")
        await add_order_event(session, order.id, "resent", "Delivery re-sent to customer")
    await send_order_delivery(order_id, ids)
    return len(ids)
