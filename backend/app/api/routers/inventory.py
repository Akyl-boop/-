"""Digital inventory management."""

from __future__ import annotations

import csv
import io
from typing import Any

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, Paging, Perm, page_response, paginate
from app.api.serializers import inventory_out
from app.core.errors import NotFound, ValidationFailed
from app.core.utils import i18n_get, utcnow
from app.models import Admin, InventoryEvent, InventoryItem, Product, ProductVariant
from app.models.enums import InventoryKind, InventoryStatus, StockMode
from app.services import inventory as inv
from app.services.audit import audit
from app.services.catalog import refresh_out_of_stock_status

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("/summary")
async def summary(session: DB, auth: Perm("inventory.view")) -> list[dict[str, Any]]:
    """Per-variant stock counters for inventory-tracked products."""
    products = (await session.execute(
        select(Product).where(Product.deleted_at.is_(None)).options(selectinload(Product.variants))
        .order_by(Product.sort_order, Product.id)
    )).scalars().all()
    counts = (await session.execute(
        select(InventoryItem.variant_id, InventoryItem.status, func.count()).group_by(InventoryItem.variant_id, InventoryItem.status)
    )).all()
    by_variant: dict[int, dict[str, int]] = {}
    for vid, status, n in counts:
        by_variant.setdefault(vid, {})[status.value if hasattr(status, "value") else status] = int(n)
    out = []
    for p in products:
        variants = []
        for v in p.variants:
            c = by_variant.get(v.id, {})
            variants.append({"id": v.id, "sku": v.sku, "name": v.name, "is_active": v.is_active,
                             "available": c.get("available", 0) if p.stock_mode == StockMode.INVENTORY else (
                                 v.manual_stock if p.stock_mode == StockMode.MANUAL else None),
                             "reserved": c.get("reserved", 0), "delivered": c.get("delivered", 0),
                             "invalid": c.get("invalid", 0), "disabled": c.get("disabled", 0)})
        available = [v["available"] for v in variants if v["is_active"]]
        total = None if any(a is None for a in available) else sum(available)
        out.append({"product_id": p.id, "name": p.name, "display_name": i18n_get(p.name, "en"), "emoji": p.emoji,
                    "status": p.status.value, "stock_mode": p.stock_mode.value, "low_stock_threshold": p.low_stock_threshold,
                    "available": total, "low": total is not None and total <= p.low_stock_threshold,
                    "variants": variants})
    return out


@router.get("")
async def list_items(session: DB, auth: Perm("inventory.view"), paging: Paging, product_id: int | None = None,
                     variant_id: int | None = None, status: str | None = None, q: str | None = None,
                     batch: str | None = None) -> dict[str, Any]:
    query = select(InventoryItem).order_by(InventoryItem.id.desc())
    if product_id:
        query = query.where(InventoryItem.product_id == product_id)
    if variant_id:
        query = query.where(InventoryItem.variant_id == variant_id)
    if status:
        query = query.where(InventoryItem.status.in_(status.split(",")))
    if batch:
        query = query.where(InventoryItem.batch == batch)
    if q:
        term = q.strip()
        conds = [InventoryItem.preview.ilike(f"%{term}%"), InventoryItem.batch.ilike(f"%{term}%"),
                 InventoryItem.note.ilike(f"%{term}%")]
        if term.isdigit():
            conds.extend([InventoryItem.id == int(term), InventoryItem.order_id == int(term)])
        # exact secret lookup via hash (never decrypts the whole table)
        from app.core.crypto import sha256_hex

        if variant_id:
            conds.append(InventoryItem.content_hash == sha256_hex(f"{variant_id}:{term}"))
        query = query.where(or_(*conds))
    items, total = await paginate(session, query, paging)
    return page_response([inventory_out(i) for i in items], total, paging)


class AddIn(BaseModel):
    variant_id: int
    items: list[str] = Field(min_length=1, max_length=20000)
    kind: InventoryKind = InventoryKind.CODE
    batch: str | None = Field(None, max_length=64)
    note: str | None = Field(None, max_length=255)


async def _variant(session: Any, variant_id: int) -> ProductVariant:
    v = await session.get(ProductVariant, variant_id)
    if v is None:
        raise NotFound("Variant not found")
    return v


@router.post("")
async def add_items(body: AddIn, session: DB, auth: Perm("inventory.manage")) -> dict[str, Any]:
    v = await _variant(session, body.variant_id)
    items = [i.strip() for i in body.items if i and i.strip()]
    if any(len(i) > inv.MAX_ITEM_LENGTH for i in items):
        raise ValidationFailed(f"Items must be shorter than {inv.MAX_ITEM_LENGTH} characters")
    report = await inv.add_items(session, v, items, kind=body.kind, admin_id=auth.admin.id,
                                 batch=body.batch or f"manual-{utcnow():%Y%m%d%H%M}", note=body.note)
    await audit(session, auth.admin, "inventory.add", f"Added {report.added} item(s) to {v.sku}", entity_type="variant",
                entity_id=v.id, new={"added": report.added, "duplicates": report.duplicates})
    return report.__dict__


@router.post("/import")
async def import_items(session: DB, auth: Perm("inventory.manage"), variant_id: int = Form(...),
                       kind: InventoryKind = Form(InventoryKind.CODE), column: str | None = Form(None),
                       file: UploadFile = File(...)) -> dict[str, Any]:
    v = await _variant(session, variant_id)
    raw = (await file.read(20 * 1024 * 1024 + 1))
    if len(raw) > 20 * 1024 * 1024:
        raise ValidationFailed("File is larger than 20 MB")
    text = raw.decode("utf-8-sig", errors="replace")
    name = (file.filename or "").lower()
    fmt = "csv" if name.endswith(".csv") else "txt"
    items, errors = inv.parse_import(text, fmt, column=column)
    if not items:
        return {"added": 0, "duplicates": 0, "invalid": len(errors), "errors": errors[:100] or ["File contains no items"]}
    report = await inv.add_items(session, v, items, kind=kind, admin_id=auth.admin.id,
                                 batch=f"import-{utcnow():%Y%m%d%H%M%S}", note=file.filename)
    report.invalid = len(errors)
    report.errors = errors[:100]
    await audit(session, auth.admin, "inventory.import", f"Imported {report.added} item(s) into {v.sku} from {file.filename}",
                entity_type="variant", entity_id=v.id, new={"added": report.added, "duplicates": report.duplicates,
                                                             "invalid": report.invalid})
    return report.__dict__


@router.get("/export")
async def export_items(session: DB, auth: Perm("inventory.reveal"), variant_id: int | None = None,
                       product_id: int | None = None, status: str = "available") -> StreamingResponse:
    query = select(InventoryItem).where(InventoryItem.status.in_(status.split(",")))
    if variant_id:
        query = query.where(InventoryItem.variant_id == variant_id)
    if product_id:
        query = query.where(InventoryItem.product_id == product_id)
    rows = (await session.execute(query.order_by(InventoryItem.id).limit(100000))).scalars().all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "sku", "status", "content", "batch", "order_id", "created_at"])
    for i in rows:
        w.writerow([i.id, i.variant.sku if i.variant else "", i.status.value, inv.reveal(i), i.batch or "", i.order_id or "",
                    i.created_at.isoformat()])
    await audit(session, auth.admin, "inventory.export", f"Exported {len(rows)} inventory item(s) with secrets",
                entity_type="variant", entity_id=variant_id)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="inventory.csv"'})


@router.get("/{item_id}/reveal")
async def reveal(item_id: int, session: DB, auth: Perm("inventory.reveal")) -> dict[str, Any]:
    item = await session.get(InventoryItem, item_id)
    if item is None:
        raise NotFound("Item not found")
    await audit(session, auth.admin, "inventory.reveal", f"Revealed inventory item #{item.id}", entity_type="inventory",
                entity_id=item.id)
    return {"id": item.id, "content": inv.reveal(item)}


class BulkIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=10000)


class StatusIn(BulkIn):
    status: InventoryStatus


@router.post("/status")
async def set_status(body: StatusIn, session: DB, auth: Perm("inventory.manage")) -> dict[str, int]:
    n = await inv.set_status(session, body.ids, body.status, auth.admin.id)
    await audit(session, auth.admin, "inventory.status", f"Marked {n} item(s) as {body.status.value}",
                new={"ids": body.ids[:100], "status": body.status.value})
    return {"updated": n}


@router.post("/delete")
async def delete_items(body: BulkIn, session: DB, auth: Perm("inventory.manage")) -> dict[str, int]:
    deletable = [InventoryStatus.AVAILABLE, InventoryStatus.INVALID, InventoryStatus.DISABLED]
    rows = (await session.execute(select(InventoryItem.id, InventoryItem.product_id, InventoryItem.variant_id)
                                  .where(InventoryItem.id.in_(body.ids), InventoryItem.status.in_(deletable)))).all()
    if rows:
        await session.execute(delete(InventoryItem).where(InventoryItem.id.in_([r[0] for r in rows])))
        groups: dict[tuple[int, int], int] = {}
        for _, pid, vid in rows:
            groups[(pid, vid)] = groups.get((pid, vid), 0) + 1
        for (pid, vid), n in groups.items():
            session.add(InventoryEvent(product_id=pid, variant_id=vid, action="deleted", quantity=n, admin_id=auth.admin.id))
        await refresh_out_of_stock_status(session, list({r[1] for r in rows}))
    await audit(session, auth.admin, "inventory.delete", f"Deleted {len(rows)} inventory item(s)")
    return {"deleted": len(rows)}


@router.get("/history")
async def history(session: DB, auth: Perm("inventory.view"), paging: Paging, product_id: int | None = None,
                  variant_id: int | None = None) -> dict[str, Any]:
    query = select(InventoryEvent).order_by(InventoryEvent.created_at.desc())
    if product_id:
        query = query.where(InventoryEvent.product_id == product_id)
    if variant_id:
        query = query.where(InventoryEvent.variant_id == variant_id)
    items, total = await paginate(session, query, paging)
    admins = {a.id: a.name for a in (await session.execute(
        select(Admin).where(Admin.id.in_([e.admin_id for e in items if e.admin_id] or [0])))).scalars()}
    return page_response([{"id": e.id, "product_id": e.product_id, "variant_id": e.variant_id, "action": e.action,
                           "quantity": e.quantity, "order_id": e.order_id, "admin": admins.get(e.admin_id),
                           "note": e.note, "created_at": e.created_at} for e in items], total, paging)
