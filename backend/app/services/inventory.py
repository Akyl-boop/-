"""Digital inventory: secure storage, bulk import, atomic reservation and delivery."""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass, field

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import decrypt_str, encrypt_str, sha256_hex
from app.core.database import on_commit
from app.core.errors import OutOfStock, ValidationFailed
from app.core.events import publish_admin_event
from app.core.utils import i18n_get, utcnow
from app.models import InventoryEvent, InventoryItem, Product, ProductVariant
from app.models.enums import InventoryKind, InventoryStatus, StockMode
from app.services.catalog import refresh_out_of_stock_status
from app.services.notifications import notify

MAX_ITEM_LENGTH = 4000


def _preview(content: str) -> str:
    content = content.strip().replace("\n", " ")
    if len(content) <= 8:
        return content[:2] + "•" * max(0, len(content) - 2)
    return content[:4] + "••••" + content[-4:]


@dataclass
class ImportReport:
    added: int = 0
    duplicates: int = 0
    invalid: int = 0
    errors: list[str] = field(default_factory=list)


def parse_import(raw: str, fmt: str, *, column: str | None = None) -> tuple[list[str], list[str]]:
    """Parse TXT (one item per line, blank-line separated blocks allowed with `---`) or CSV.

    Returns (items, errors).
    """
    items: list[str] = []
    errors: list[str] = []
    if fmt == "csv":
        reader = csv.DictReader(io.StringIO(raw))
        if not reader.fieldnames:
            return [], ["CSV has no header row"]
        col = column or ("content" if "content" in reader.fieldnames else reader.fieldnames[0])
        if col not in reader.fieldnames:
            return [], [f"Column '{col}' not found. Available: {', '.join(reader.fieldnames)}"]
        for i, row in enumerate(reader, start=2):
            value = (row.get(col) or "").strip()
            if not value:
                errors.append(f"Row {i}: empty value")
                continue
            items.append(value)
    else:
        if "\n---\n" in raw:
            chunks = [c.strip() for c in raw.split("\n---\n")]
        else:
            chunks = [line.strip() for line in raw.splitlines()]
        items = [c for c in chunks if c]
    good = []
    for idx, item in enumerate(items, start=1):
        if len(item) > MAX_ITEM_LENGTH:
            errors.append(f"Item {idx}: longer than {MAX_ITEM_LENGTH} characters")
        else:
            good.append(item)
    return good, errors


async def add_items(
    session: AsyncSession,
    variant: ProductVariant,
    contents: list[str],
    *,
    kind: InventoryKind = InventoryKind.CODE,
    admin_id: int | None = None,
    batch: str | None = None,
    note: str | None = None,
) -> ImportReport:
    report = ImportReport()
    seen: set[str] = set()
    rows = []
    for content in contents:
        h = sha256_hex(f"{variant.id}:{content}")
        if h in seen:
            report.duplicates += 1
            continue
        seen.add(h)
        rows.append(
            {
                "product_id": variant.product_id, "variant_id": variant.id, "kind": kind.value,
                "content_enc": encrypt_str(content), "content_hash": h, "preview": _preview(content),
                "status": InventoryStatus.AVAILABLE.value, "batch": batch, "note": note, "created_by": admin_id,
            }
        )
    if rows:
        for i in range(0, len(rows), 1000):
            chunk = rows[i : i + 1000]
            res = await session.execute(
                insert(InventoryItem).values(chunk)
                .on_conflict_do_nothing(constraint="uq_inventory_variant_hash")
                .returning(InventoryItem.id)
            )
            inserted = len(res.all())
            report.added += inserted
            report.duplicates += len(chunk) - inserted
    if report.added:
        session.add(InventoryEvent(product_id=variant.product_id, variant_id=variant.id, action="added",
                                   quantity=report.added, admin_id=admin_id, note=note or batch))
        await refresh_out_of_stock_status(session, [variant.product_id])
        on_commit(session, lambda: _restock_hook(variant.product_id))
    return report


async def _restock_hook(product_id: int) -> None:
    from app.core.queue import enqueue

    await enqueue("notify_restock", product_id, _job_id=f"restock:{product_id}", _defer_by=5)
    await publish_admin_event("inventory.changed", {"product_id": product_id})


async def reserve(session: AsyncSession, variant_id: int, quantity: int, order_id: int, order_item_id: int) -> list[int]:
    """Atomically reserve `quantity` available items. Uses SKIP LOCKED so concurrent checkouts never
    receive the same item; raises OutOfStock if not enough items are free."""
    ids = list(
        (
            await session.execute(
                select(InventoryItem.id)
                .where(InventoryItem.variant_id == variant_id, InventoryItem.status == InventoryStatus.AVAILABLE)
                .order_by(InventoryItem.id)
                .limit(quantity)
                .with_for_update(skip_locked=True)
            )
        ).scalars()
    )
    if len(ids) < quantity:
        raise OutOfStock("Not enough stock", details={"variant_id": variant_id, "available": len(ids)})
    await session.execute(
        update(InventoryItem)
        .where(InventoryItem.id.in_(ids))
        .values(status=InventoryStatus.RESERVED, order_id=order_id, order_item_id=order_item_id, reserved_at=utcnow())
    )
    return ids


async def release_for_order(session: AsyncSession, order_id: int) -> int:
    res = await session.execute(
        update(InventoryItem)
        .where(InventoryItem.order_id == order_id, InventoryItem.status == InventoryStatus.RESERVED)
        .values(status=InventoryStatus.AVAILABLE, order_id=None, order_item_id=None, reserved_at=None)
        .returning(InventoryItem.product_id, InventoryItem.variant_id)
    )
    rows = res.all()
    if rows:
        by_variant: dict[tuple[int, int], int] = {}
        for pid, vid in rows:
            by_variant[(pid, vid)] = by_variant.get((pid, vid), 0) + 1
        for (pid, vid), n in by_variant.items():
            session.add(InventoryEvent(product_id=pid, variant_id=vid, action="released", quantity=n, order_id=order_id))
        await refresh_out_of_stock_status(session, list({pid for pid, _ in rows}))
    return len(rows)


async def take_reserved(session: AsyncSession, order_item_id: int, quantity: int) -> list[InventoryItem]:
    items = list(
        (
            await session.execute(
                select(InventoryItem)
                .where(InventoryItem.order_item_id == order_item_id, InventoryItem.status == InventoryStatus.RESERVED)
                .order_by(InventoryItem.id)
                .limit(quantity)
                .with_for_update(of=InventoryItem)
            )
        ).scalars()
    )
    return items


def reveal(item: InventoryItem) -> str:
    return decrypt_str(item.content_enc) or ""


async def mark_delivered(session: AsyncSession, items: list[InventoryItem], order_id: int) -> None:
    now = utcnow()
    for item in items:
        item.status = InventoryStatus.DELIVERED
        item.delivered_at = now
    if items:
        session.add(InventoryEvent(product_id=items[0].product_id, variant_id=items[0].variant_id, action="delivered",
                                   quantity=len(items), order_id=order_id))


async def variant_stock(session: AsyncSession, variant: ProductVariant, product: Product) -> int | None:
    if product.stock_mode == StockMode.UNLIMITED:
        return None
    if product.stock_mode == StockMode.MANUAL:
        return max(variant.manual_stock, 0)
    return int(
        (
            await session.execute(
                select(func.count()).select_from(InventoryItem)
                .where(InventoryItem.variant_id == variant.id, InventoryItem.status == InventoryStatus.AVAILABLE)
            )
        ).scalar_one()
    )


async def check_low_stock(session: AsyncSession, product_ids: list[int]) -> None:
    """Raise low-stock / out-of-stock notifications (deduplicated) for inventory-tracked products."""
    if not product_ids:
        return
    products = (
        await session.execute(select(Product).where(Product.id.in_(product_ids), Product.deleted_at.is_(None)))
    ).scalars().unique().all()
    for p in products:
        if p.stock_mode == StockMode.UNLIMITED:
            continue
        total = 0
        for v in p.variants:
            if v.is_active:
                total += (await variant_stock(session, v, p)) or 0
        name = i18n_get(p.name, "en")
        if total == 0:
            await notify(session, "out_of_stock", "Out of stock", name, link=f"/inventory?product={p.id}",
                         telegram_vars={"product": name}, data={"product_id": p.id},
                         dedupe_key=f"{p.id}", dedupe_ttl=6 * 3600)
        elif total <= p.low_stock_threshold:
            await notify(session, "low_stock", "Low stock", f"{name}: {total} left", link=f"/inventory?product={p.id}",
                         telegram_vars={"product": name, "count": total}, data={"product_id": p.id, "count": total},
                         dedupe_key=f"{p.id}:{total // max(1, p.low_stock_threshold)}", dedupe_ttl=6 * 3600)


async def set_status(session: AsyncSession, item_ids: list[int], status: InventoryStatus, admin_id: int | None) -> int:
    if status not in (InventoryStatus.AVAILABLE, InventoryStatus.INVALID, InventoryStatus.DISABLED):
        raise ValidationFailed("Unsupported status change")
    res = await session.execute(
        update(InventoryItem)
        .where(InventoryItem.id.in_(item_ids),
               InventoryItem.status.in_([InventoryStatus.AVAILABLE, InventoryStatus.INVALID, InventoryStatus.DISABLED]))
        .values(status=status)
        .returning(InventoryItem.product_id, InventoryItem.variant_id)
    )
    rows = res.all()
    for pid, vid in {(r[0], r[1]) for r in rows}:
        n = sum(1 for r in rows if r[0] == pid and r[1] == vid)
        session.add(InventoryEvent(product_id=pid, variant_id=vid, action=f"set_{status.value}", quantity=n, admin_id=admin_id))
    await refresh_out_of_stock_status(session, list({r[0] for r in rows}))
    return len(rows)
