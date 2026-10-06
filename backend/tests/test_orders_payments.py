"""End-to-end order lifecycle: reservation → payment → idempotent confirmation → fulfillment."""

import asyncio
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.core.database import SessionLocal, session_scope
from app.core.errors import OutOfStock
from app.fulfillment.service import delivered_units, fulfill_order
from app.models import InventoryItem, Order, Payment, PaymentMethod, User
from app.models.enums import (
    BalanceTxType,
    DeliveryMode,
    InventoryStatus,
    OrderStatus,
    PaymentStatus,
    StockMode,
)
from app.payments import service as payments
from app.services.customers import adjust_balance
from app.services.orders import LineRequest, cancel_order, create_order, lock_order


async def _enable_manual() -> None:
    async with session_scope() as s:
        m = (await s.execute(select(PaymentMethod).where(PaymentMethod.code == "manual"))).scalar_one()
        m.enabled = True


async def _new_order(user_id: int, variant_id: int, qty: int = 1, **kw) -> int:
    async with session_scope() as s:
        user = await s.get(User, user_id)
        order = await create_order(s, user, [LineRequest(variant_id, qty)], **kw)
        return order.id


async def _counts(variant_id: int) -> dict[str, int]:
    async with SessionLocal() as s:
        rows = (await s.execute(select(InventoryItem.status, func.count()).where(InventoryItem.variant_id == variant_id)
                                .group_by(InventoryItem.status))).all()
        return {st.value: n for st, n in rows}


async def test_order_reserves_inventory_and_completes_after_payment(make_user, make_product) -> None:
    await _enable_manual()
    user = await make_user()
    product, variant = await make_product(price="12.50", codes=3)
    order_id = await _new_order(user.id, variant.id, 2)
    assert (await _counts(variant.id)) == {"reserved": 2, "available": 1}

    async with session_scope() as s:
        payment = await payments.start_payment(s, order_id, "manual")
        pid = payment.id
    async with session_scope() as s:
        assert await payments.confirm_paid(s, pid, source="test") is True
    # Duplicate confirmation (e.g. webhook replay) must be a no-op
    async with session_scope() as s:
        assert await payments.confirm_paid(s, pid, source="test") is False

    result = await fulfill_order(order_id)
    assert result["status"] == "completed"
    assert (await _counts(variant.id)) == {"delivered": 2, "available": 1}
    # Fulfilling again never delivers twice
    again = await fulfill_order(order_id)
    assert again["status"] == "skipped"
    async with SessionLocal() as s:
        order = await s.get(Order, order_id)
        assert order.status == OrderStatus.COMPLETED
        units = delivered_units(order.items[0])
        assert len(units) == 2 and all(u["value"].startswith("CODE-") for u in units)
        u = await s.get(User, user.id)
        assert u.paid_orders_count == 1 and u.total_spent == Decimal("25.00")


async def test_out_of_stock_rejected(make_user, make_product) -> None:
    user = await make_user()
    _, variant = await make_product(codes=1)
    with pytest.raises(OutOfStock):
        await _new_order(user.id, variant.id, 2)
    assert (await _counts(variant.id)) == {"available": 1}


async def test_concurrent_checkouts_never_sell_the_same_item(make_user, make_product) -> None:
    _, variant = await make_product(codes=3)
    users = [await make_user() for _ in range(8)]
    results = await asyncio.gather(*[_new_order(u.id, variant.id, 1) for u in users], return_exceptions=True)
    ok = [r for r in results if isinstance(r, int)]
    failed = [r for r in results if isinstance(r, OutOfStock)]
    assert len(ok) == 3 and len(failed) == 5
    async with SessionLocal() as s:
        reserved = (await s.execute(select(InventoryItem.order_id).where(InventoryItem.variant_id == variant.id))).scalars().all()
        assert len(set(reserved)) == 3  # every item reserved by a different order


async def test_cancel_releases_stock_and_returns_balance(make_user, make_product) -> None:
    user = await make_user()
    _, variant = await make_product(price="10.00", codes=2)
    async with session_scope() as s:
        await adjust_balance(s, user.id, Decimal("4.00"), BalanceTxType.ADJUSTMENT, note="test")
    order_id = await _new_order(user.id, variant.id, 1, use_balance=True)
    async with SessionLocal() as s:
        order = await s.get(Order, order_id)
        assert order.balance_used == Decimal("4.00") and order.total == Decimal("6.00")
        assert (await s.get(User, user.id)).balance == Decimal("0.00")
    async with session_scope() as s:
        order = await lock_order(s, order_id)
        await cancel_order(s, order, reason="test")
    assert (await _counts(variant.id)) == {"available": 2}
    async with SessionLocal() as s:
        assert (await s.get(User, user.id)).balance == Decimal("4.00")
        assert (await s.get(Order, order_id)).status == OrderStatus.CANCELLED


async def test_manual_stock_counter(make_user, make_product) -> None:
    user = await make_user()
    _, variant = await make_product(stock_mode=StockMode.MANUAL, delivery=DeliveryMode.MANUAL, manual_stock=2)
    oid = await _new_order(user.id, variant.id, 2)
    with pytest.raises(OutOfStock):
        await _new_order(user.id, variant.id, 1)
    async with session_scope() as s:
        await cancel_order(s, await lock_order(s, oid), reason="x")
    await _new_order(user.id, variant.id, 1)


async def test_manual_delivery_mode_waits_for_admin(make_user, make_product) -> None:
    await _enable_manual()
    user = await make_user()
    _, variant = await make_product(stock_mode=StockMode.UNLIMITED, delivery=DeliveryMode.MANUAL)
    oid = await _new_order(user.id, variant.id, 1)
    async with session_scope() as s:
        p = await payments.start_payment(s, oid, "manual")
        await payments.confirm_paid(s, p.id, source="test")
    r = await fulfill_order(oid)
    assert r["status"] == "processing"
    from app.fulfillment.service import deliver_manually

    async with session_scope() as s:
        order = await s.get(Order, oid)
        await deliver_manually(s, order.items[0].id, ["account: demo / pass"], None)
    async with SessionLocal() as s:
        assert (await s.get(Order, oid)).status == OrderStatus.COMPLETED


async def test_text_delivery_and_expiry(make_user, make_product) -> None:
    user = await make_user()
    _, variant = await make_product(stock_mode=StockMode.UNLIMITED, delivery=DeliveryMode.TEXT,
                                    config={"text": {"en": "https://example.com/redeem"}})
    oid = await _new_order(user.id, variant.id, 1)
    # Expire: move deadline to the past
    async with session_scope() as s:
        o = await s.get(Order, oid)
        from datetime import timedelta

        from app.core.utils import utcnow

        o.expires_at = utcnow() - timedelta(minutes=1)
    async with session_scope() as s:
        expired = await payments.expire_overdue(s)
    assert oid in expired
    async with SessionLocal() as s:
        assert (await s.get(Order, oid)).status == OrderStatus.EXPIRED


async def test_late_payment_after_expiry_is_honoured(make_user, make_product) -> None:
    await _enable_manual()
    user = await make_user()
    _, variant = await make_product(codes=1)
    oid = await _new_order(user.id, variant.id, 1)
    async with session_scope() as s:
        p = await payments.start_payment(s, oid, "manual")
        pid = p.id
    async with session_scope() as s:
        await cancel_order(s, await lock_order(s, oid), reason="expired", expired=True)
    assert (await _counts(variant.id)) == {"available": 1}
    # Money arrives late (e.g. blockchain) → order is paid and stock re-reserved on fulfillment
    async with session_scope() as s:
        await s.execute(Payment.__table__.update().where(Payment.id == pid).values(status=PaymentStatus.PENDING))
    async with session_scope() as s:
        assert await payments.confirm_paid(s, pid, source="late") is True
    r = await fulfill_order(oid)
    assert r["status"] == "completed"
    assert (await _counts(variant.id)) == {"delivered": 1}


async def test_inventory_import_dedup(make_product) -> None:
    from app.services import inventory as inv

    _, variant = await make_product(codes=0)
    items, errors = inv.parse_import("A\nB\n\nA\n", "txt")
    assert items == ["A", "B", "A"] and not errors
    async with session_scope() as s:
        v = await s.get(type(variant), variant.id)
        r1 = await inv.add_items(s, v, items)
    assert r1.added == 2 and r1.duplicates == 1
    async with session_scope() as s:
        v = await s.get(type(variant), variant.id)
        r2 = await inv.add_items(s, v, ["B", "C"])
    assert r2.added == 1 and r2.duplicates == 1
    csv_items, csv_errors = inv.parse_import("content,note\nX1,a\n,b\nX2,c\n", "csv")
    assert csv_items == ["X1", "X2"] and len(csv_errors) == 1
    assert InventoryStatus.AVAILABLE.value == "available"
