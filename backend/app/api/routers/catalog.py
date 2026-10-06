"""Products, variants and categories."""

from __future__ import annotations

import csv
import io
import uuid
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import selectinload

from app.api.deps import DB, Paging, Perm, page_response, paginate
from app.api.serializers import category_out, product_out
from app.core.cache import content_cache
from app.core.crypto import encrypt_str
from app.core.database import on_commit
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.utils import i18n_get, random_code, slugify, utcnow
from app.models import Category, InventoryItem, OrderItem, Product, ProductVariant
from app.models.enums import DeliveryMode, ProductStatus, StockMode
from app.security.html import sanitize_telegram_html
from app.services.audit import audit, diff, snapshot
from app.services.catalog import refresh_out_of_stock_status, stock_map

router = APIRouter(tags=["catalog"])
I18n = dict[str, str]


def _clean_i18n(value: dict[str, str] | None, html: bool = False, max_len: int = 4000) -> dict[str, str]:
    out = {}
    for k, v in (value or {}).items():
        if not isinstance(k, str) or len(k) > 8 or v is None:
            continue
        v = str(v)[:max_len]
        out[k] = sanitize_telegram_html(v) if html else v.strip()
    return out


# ─── Categories ─────────────────────────────────────────────────────────────


class CategoryIn(BaseModel):
    name: I18n
    slug: str | None = None
    description: I18n | None = None
    parent_id: int | None = None
    emoji: str | None = Field(None, max_length=32)
    custom_emoji_id: str | None = Field(None, max_length=32, pattern=r"^\d*$")
    media_id: uuid.UUID | None = None
    sort_order: int = 0
    is_visible: bool = True

    @field_validator("name")
    @classmethod
    def _name(cls, v: I18n) -> I18n:
        if not any((x or "").strip() for x in v.values()):
            raise ValueError("Name is required")
        return v


@router.get("/categories")
async def list_categories(session: DB, auth: Perm("products.view")) -> list[dict[str, Any]]:
    counts = dict((await session.execute(
        select(Product.category_id, func.count(Product.id)).where(Product.deleted_at.is_(None)).group_by(Product.category_id)
    )).all())
    cats = (await session.execute(select(Category).where(Category.deleted_at.is_(None))
                                  .order_by(Category.sort_order, Category.id))).scalars().all()
    return [category_out(c, counts.get(c.id, 0)) for c in cats]


async def _unique_slug(session: Any, model: Any, base: str, exclude_id: int | None = None) -> str:
    slug = slugify(base)
    candidate = slug
    i = 2
    while True:
        q = select(model.id).where(model.slug == candidate)
        if exclude_id:
            q = q.where(model.id != exclude_id)
        if not (await session.execute(q)).first():
            return candidate
        candidate = f"{slug}-{i}"
        i += 1


def _invalidate_content(session: Any) -> None:
    on_commit(session, content_cache.invalidate)


@router.post("/categories", status_code=201)
async def create_category(body: CategoryIn, session: DB, auth: Perm("categories.edit")) -> dict[str, Any]:
    cat = Category(
        name=_clean_i18n(body.name, max_len=120), description=_clean_i18n(body.description, html=True),
        slug=await _unique_slug(session, Category, body.slug or i18n_get(body.name, "en")), parent_id=body.parent_id,
        emoji=body.emoji, custom_emoji_id=body.custom_emoji_id or None, media_id=body.media_id,
        sort_order=body.sort_order, is_visible=body.is_visible,
    )
    session.add(cat)
    await session.flush()
    await audit(session, auth.admin, "category.create", f"Created category {i18n_get(cat.name, 'en')}",
                entity_type="category", entity_id=cat.id)
    _invalidate_content(session)
    return category_out(cat, 0)


@router.put("/categories/{cat_id}")
async def update_category(cat_id: int, body: CategoryIn, session: DB, auth: Perm("categories.edit")) -> dict[str, Any]:
    cat = await session.get(Category, cat_id)
    if cat is None or cat.deleted_at is not None:
        raise NotFound("Category not found")
    if body.parent_id == cat.id:
        raise ValidationFailed("A category cannot be its own parent")
    fields = ["name", "description", "parent_id", "emoji", "custom_emoji_id", "media_id", "sort_order", "is_visible", "slug"]
    old = snapshot(cat, fields)
    cat.name = _clean_i18n(body.name, max_len=120)
    cat.description = _clean_i18n(body.description, html=True)
    cat.parent_id = body.parent_id
    cat.emoji = body.emoji
    cat.custom_emoji_id = body.custom_emoji_id or None
    cat.media_id = body.media_id
    cat.sort_order = body.sort_order
    cat.is_visible = body.is_visible
    if body.slug and body.slug != cat.slug:
        cat.slug = await _unique_slug(session, Category, body.slug, exclude_id=cat.id)
    o, n = diff(old, snapshot(cat, fields))
    await audit(session, auth.admin, "category.update", f"Updated category {i18n_get(cat.name, 'en')}",
                entity_type="category", entity_id=cat.id, old=o, new=n)
    _invalidate_content(session)
    return category_out(cat)


@router.delete("/categories/{cat_id}")
async def delete_category(cat_id: int, session: DB, auth: Perm("categories.edit")) -> dict[str, str]:
    cat = await session.get(Category, cat_id)
    if cat is None:
        raise NotFound("Category not found")
    in_use = (await session.execute(select(func.count()).select_from(Product)
                                    .where(Product.category_id == cat.id, Product.deleted_at.is_(None)))).scalar_one()
    if in_use:
        raise Conflict(f"Category contains {in_use} product(s). Move or delete them first.")
    cat.deleted_at = utcnow()
    cat.slug = f"{cat.slug}-deleted-{cat.id}"
    for child in (await session.execute(select(Category).where(Category.parent_id == cat.id))).scalars():
        child.parent_id = cat.parent_id
    await audit(session, auth.admin, "category.delete", f"Deleted category {i18n_get(cat.name, 'en')}",
                entity_type="category", entity_id=cat.id)
    _invalidate_content(session)
    return {"status": "ok"}


class ReorderIn(BaseModel):
    ids: list[int] = Field(max_length=2000)


@router.post("/categories/reorder")
async def reorder_categories(body: ReorderIn, session: DB, auth: Perm("categories.edit")) -> dict[str, str]:
    cats = {c.id: c for c in (await session.execute(select(Category).where(Category.id.in_(body.ids)))).scalars()}
    for i, cid in enumerate(body.ids):
        if cid in cats:
            cats[cid].sort_order = i
    await audit(session, auth.admin, "category.reorder", "Reordered categories")
    _invalidate_content(session)
    return {"status": "ok"}


# ─── Products ───────────────────────────────────────────────────────────────


class VariantIn(BaseModel):
    id: int | None = None
    sku: str | None = Field(None, max_length=64)
    name: I18n
    attributes: dict[str, str] = Field(default_factory=dict)
    price: Decimal = Field(ge=0, max_digits=16, decimal_places=2)
    old_price: Decimal | None = Field(None, ge=0)
    cost_price: Decimal | None = Field(None, ge=0)
    manual_stock: int = Field(0, ge=0)
    delivery_mode: DeliveryMode | None = None
    fulfillment_config: dict[str, Any] | None = None
    instructions: I18n | None = None
    is_active: bool = True


class ProductIn(BaseModel):
    name: I18n
    slug: str | None = None
    category_id: int | None = None
    short_description: I18n | None = None
    description: I18n | None = None
    emoji: str | None = Field(None, max_length=32)
    custom_emoji_id: str | None = Field(None, max_length=32, pattern=r"^\d*$")
    media_id: uuid.UUID | None = None
    status: ProductStatus = ProductStatus.DRAFT
    currency: str | None = Field(None, max_length=8)
    sort_order: int = 0
    is_featured: bool = False
    tags: list[str] = Field(default_factory=list, max_length=30)
    stock_mode: StockMode = StockMode.INVENTORY
    delivery_mode: DeliveryMode = DeliveryMode.INVENTORY
    fulfillment_config: dict[str, Any] = Field(default_factory=dict)
    warranty: I18n | None = None
    delivery_instructions: I18n | None = None
    min_quantity: int = Field(1, ge=1, le=1000)
    max_quantity: int | None = Field(None, ge=1, le=10000)
    max_per_customer: int | None = Field(None, ge=1)
    regions: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    option_groups: list[dict[str, Any]] = Field(default_factory=list, max_length=4)
    low_stock_threshold: int = Field(5, ge=0)
    variants: list[VariantIn] = Field(min_length=1, max_length=200)

    @field_validator("name")
    @classmethod
    def _name(cls, v: I18n) -> I18n:
        if not any((x or "").strip() for x in v.values()):
            raise ValueError("Product name is required")
        return v


def _fulfillment_config(incoming: dict[str, Any] | None, existing: dict[str, Any] | None) -> dict[str, Any]:
    """Encrypt secret fields (secret, auth); keep the existing encrypted value when the field is omitted."""
    incoming = dict(incoming or {})
    out = {k: v for k, v in (existing or {}).items() if k.endswith("_enc")}
    for key in ("secret", "auth"):
        if key in incoming:
            value = incoming.pop(key)
            if value:
                out[f"{key}_enc"] = encrypt_str(str(value))
            else:
                out.pop(f"{key}_enc", None)
    for k in list(incoming):
        if k.endswith("_enc") or k.endswith("_set"):
            incoming.pop(k)
    if "text" in incoming and isinstance(incoming["text"], dict):
        incoming["text"] = _clean_i18n(incoming["text"], html=False)
    if "url" in incoming and incoming["url"] and not str(incoming["url"]).startswith(("https://", "http://")):
        raise ValidationFailed("Fulfillment URL must start with http(s)://")
    out.update(incoming)
    return out


async def _load_product(session: Any, product_id: int) -> Product:
    p = (await session.execute(select(Product).where(Product.id == product_id, Product.deleted_at.is_(None))
                               .options(selectinload(Product.variants)))).scalar_one_or_none()
    if p is None:
        raise NotFound("Product not found")
    return p


async def _apply_product(session: Any, p: Product, body: ProductIn) -> None:
    p.name = _clean_i18n(body.name, max_len=200)
    p.short_description = _clean_i18n(body.short_description, max_len=300)
    p.description = _clean_i18n(body.description, html=True)
    p.category_id = body.category_id
    p.emoji = body.emoji
    p.custom_emoji_id = body.custom_emoji_id or None
    p.media_id = body.media_id
    p.status = body.status
    p.currency = body.currency or None
    p.sort_order = body.sort_order
    p.is_featured = body.is_featured
    p.tags = [t.strip()[:48] for t in body.tags if t.strip()]
    p.stock_mode = body.stock_mode
    p.delivery_mode = body.delivery_mode
    p.fulfillment_config = _fulfillment_config(body.fulfillment_config, p.fulfillment_config)
    p.warranty = _clean_i18n(body.warranty, max_len=300)
    p.delivery_instructions = _clean_i18n(body.delivery_instructions, html=True)
    p.min_quantity = body.min_quantity
    p.max_quantity = body.max_quantity
    p.max_per_customer = body.max_per_customer
    p.regions = [r.upper()[:8] for r in body.regions]
    p.languages = [lang[:8] for lang in body.languages]
    p.option_groups = [{"key": slugify(str(g.get("key") or i18n_get(g.get("name"), "en")))[:32],
                        "name": _clean_i18n(g.get("name") if isinstance(g.get("name"), dict) else {"en": str(g.get("name") or "")})}
                       for g in body.option_groups if g.get("key") or g.get("name")]
    p.low_stock_threshold = body.low_stock_threshold
    if body.slug and body.slug != p.slug:
        p.slug = await _unique_slug(session, Product, body.slug, exclude_id=p.id)
    elif not p.slug:
        p.slug = await _unique_slug(session, Product, i18n_get(body.name, "en"))

    existing = {v.id: v for v in p.variants}
    keep_ids = set()
    for idx, vin in enumerate(body.variants):
        v = existing.get(vin.id) if vin.id else None
        if v is None:
            v = ProductVariant(sku="")
            p.variants.append(v)
        sku = (vin.sku or "").strip() or f"{p.slug[:12].upper()}-{random_code(5)}"
        dup = (await session.execute(select(ProductVariant.id).where(ProductVariant.sku == sku,
                                                                     ProductVariant.id != (v.id or 0)))).first()
        if dup:
            raise ValidationFailed(f"SKU {sku} is already used by another variant")
        v.sku = sku
        v.name = _clean_i18n(vin.name, max_len=120) or {"en": "Standard"}
        v.attributes = {k[:32]: str(val)[:64] for k, val in vin.attributes.items()}
        v.price = vin.price
        v.old_price = vin.old_price
        v.cost_price = vin.cost_price
        v.manual_stock = vin.manual_stock
        v.delivery_mode = vin.delivery_mode
        v.fulfillment_config = _fulfillment_config(vin.fulfillment_config, v.fulfillment_config) if vin.fulfillment_config else None
        v.instructions = _clean_i18n(vin.instructions, html=True)
        v.sort_order = idx
        v.is_active = vin.is_active
        v.is_default = idx == 0
        if v.id:
            keep_ids.add(v.id)
    for vid, v in existing.items():
        if vid in keep_ids:
            continue
        used = (await session.execute(select(func.count()).select_from(InventoryItem).where(InventoryItem.variant_id == vid))).scalar_one() + \
            (await session.execute(select(func.count()).select_from(OrderItem).where(OrderItem.variant_id == vid))).scalar_one()
        if used:
            v.is_active = False  # keep history; hide from storefront
        else:
            p.variants.remove(v)
            await session.delete(v)


@router.get("/products")
async def list_products(session: DB, auth: Perm("products.view"), paging: Paging, q: str | None = None,
                        status: str | None = None, category_id: int | None = None, sort: str = "sort_order") -> dict[str, Any]:
    query = select(Product).where(Product.deleted_at.is_(None)).options(selectinload(Product.variants))
    if q:
        term = f"%{q.strip()}%"
        query = query.where(or_(cast(Product.name, String).ilike(term),
                                Product.slug.ilike(term),
                                Product.id.in_(select(ProductVariant.product_id).where(ProductVariant.sku.ilike(term)))))
    if status:
        query = query.where(Product.status.in_(status.split(",")))
    if category_id:
        query = query.where(Product.category_id == category_id)
    col = {"sort_order": Product.sort_order, "created_at": Product.created_at, "sold": Product.sold_count,
           "name": Product.slug}.get(sort.lstrip("-"), Product.sort_order)
    query = query.order_by(col.desc() if sort.startswith("-") else col.asc(), Product.id)
    items, total = await paginate(session, query, paging)
    stocks = await stock_map(session, items)
    return page_response([product_out(p, stocks, full=False) for p in items], total, paging)


@router.get("/products/export")
async def export_products(session: DB, auth: Perm("products.view")) -> StreamingResponse:
    products = (await session.execute(select(Product).where(Product.deleted_at.is_(None))
                                      .options(selectinload(Product.variants)).order_by(Product.sort_order))).scalars().all()
    cats = {c.id: c.slug for c in (await session.execute(select(Category))).scalars()}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["slug", "name_en", "name_ru", "name_zh", "category_slug", "status", "emoji", "stock_mode", "delivery_mode",
                "sku", "variant_en", "price", "old_price", "cost_price", "short_description_en"])
    for p in products:
        for v in p.variants:
            w.writerow([p.slug, p.name.get("en", ""), p.name.get("ru", ""), p.name.get("zh", ""), cats.get(p.category_id, ""),
                        p.status.value, p.emoji or "", p.stock_mode.value, p.delivery_mode.value, v.sku, v.name.get("en", ""),
                        v.price, v.old_price or "", v.cost_price or "", (p.short_description or {}).get("en", "")])
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": 'attachment; filename="products.csv"'})


@router.post("/products/import")
async def import_products(session: DB, auth: Perm("products.edit"), file: UploadFile = File(...)) -> dict[str, Any]:
    raw = (await file.read(5 * 1024 * 1024)).decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(raw))
    required = {"slug", "name_en", "price"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        raise ValidationFailed(f"CSV must contain columns: {', '.join(sorted(required))}")
    cats = {c.slug: c.id for c in (await session.execute(select(Category).where(Category.deleted_at.is_(None)))).scalars()}
    errors: list[str] = []
    created = updated = 0
    rows_by_slug: dict[str, list[dict[str, str]]] = {}
    for i, row in enumerate(reader, start=2):
        slug = slugify(row.get("slug") or row.get("name_en") or "")
        try:
            Decimal(row.get("price") or "x")
        except Exception:
            errors.append(f"Row {i}: invalid price '{row.get('price')}'")
            continue
        if not (row.get("name_en") or "").strip():
            errors.append(f"Row {i}: name_en is required")
            continue
        if row.get("status") and row["status"] not in ProductStatus._value2member_map_:
            errors.append(f"Row {i}: unknown status '{row['status']}'")
            continue
        if row.get("category_slug") and row["category_slug"] not in cats:
            errors.append(f"Row {i}: unknown category '{row['category_slug']}'")
            continue
        rows_by_slug.setdefault(slug, []).append(row)
    if errors:
        return {"created": 0, "updated": 0, "errors": errors[:200]}
    for slug, rows in rows_by_slug.items():
        first = rows[0]
        p = (await session.execute(select(Product).where(Product.slug == slug).options(selectinload(Product.variants)))).scalar_one_or_none()
        is_new = p is None
        if p is None:
            p = Product(slug=slug, name={}, status=ProductStatus.DRAFT)
            session.add(p)
        p.name = {k: first.get(f"name_{k}", "").strip() for k in ("en", "ru", "zh") if first.get(f"name_{k}", "").strip()}
        p.category_id = cats.get(first.get("category_slug") or "") or p.category_id
        p.status = ProductStatus(first["status"]) if first.get("status") else p.status
        p.emoji = first.get("emoji") or p.emoji
        if first.get("stock_mode") in StockMode._value2member_map_:
            p.stock_mode = StockMode(first["stock_mode"])
        if first.get("delivery_mode") in DeliveryMode._value2member_map_:
            p.delivery_mode = DeliveryMode(first["delivery_mode"])
        if first.get("short_description_en"):
            p.short_description = {**(p.short_description or {}), "en": first["short_description_en"]}
        await session.flush()
        by_sku = {v.sku: v for v in p.variants}
        for idx, row in enumerate(rows):
            sku = (row.get("sku") or "").strip() or f"{slug[:12].upper()}-{random_code(5)}"
            v = by_sku.get(sku)
            if v is None:
                v = ProductVariant(product_id=p.id, sku=sku, sort_order=idx, is_default=idx == 0)
                session.add(v)
            v.name = {"en": row.get("variant_en") or "Standard"}
            v.price = Decimal(row["price"])
            v.old_price = Decimal(row["old_price"]) if row.get("old_price") else None
            v.cost_price = Decimal(row["cost_price"]) if row.get("cost_price") else None
        created += is_new
        updated += not is_new
    await audit(session, auth.admin, "products.import", f"Imported products: {created} created, {updated} updated")
    _invalidate_content(session)
    return {"created": created, "updated": updated, "errors": []}


@router.get("/products/{product_id}")
async def get_product(product_id: int, session: DB, auth: Perm("products.view")) -> dict[str, Any]:
    p = await _load_product(session, product_id)
    return product_out(p, await stock_map(session, [p]))


@router.post("/products", status_code=201)
async def create_product(body: ProductIn, session: DB, auth: Perm("products.edit")) -> dict[str, Any]:
    p = Product(slug="", name={})
    session.add(p)
    p.variants = []
    await _apply_product(session, p, body)
    await session.flush()
    await refresh_out_of_stock_status(session, [p.id])
    await audit(session, auth.admin, "product.create", f"Created product {i18n_get(p.name, 'en')}", entity_type="product",
                entity_id=p.id)
    p = await _load_product(session, p.id)
    return product_out(p, await stock_map(session, [p]))


@router.put("/products/{product_id}")
async def update_product(product_id: int, body: ProductIn, session: DB, auth: Perm("products.edit")) -> dict[str, Any]:
    p = await _load_product(session, product_id)
    fields = ["name", "status", "category_id", "emoji", "stock_mode", "delivery_mode", "sort_order", "is_featured",
              "min_quantity", "max_quantity", "media_id"]
    old = snapshot(p, fields)
    old_prices = {v.sku: str(v.price) for v in p.variants}
    await _apply_product(session, p, body)
    await session.flush()
    await refresh_out_of_stock_status(session, [p.id])
    o, n = diff(old, snapshot(p, fields))
    new_prices = {v.sku: str(v.price) for v in p.variants}
    if old_prices != new_prices:
        o["prices"], n["prices"] = old_prices, new_prices
    summary = f"Updated product {i18n_get(p.name, 'en')}"
    if "prices" in n:
        summary = f"Changed price of {i18n_get(p.name, 'en')}"
    await audit(session, auth.admin, "product.update", summary, entity_type="product", entity_id=p.id, old=o, new=n)
    _invalidate_content(session)
    p = await _load_product(session, p.id)
    return product_out(p, await stock_map(session, [p]))


@router.post("/products/{product_id}/duplicate", status_code=201)
async def duplicate_product(product_id: int, session: DB, auth: Perm("products.edit")) -> dict[str, Any]:
    src = await _load_product(session, product_id)
    copy = Product(
        slug=await _unique_slug(session, Product, f"{src.slug}-copy"),
        name={k: f"{v} (copy)" for k, v in src.name.items()}, short_description=src.short_description,
        description=src.description, category_id=src.category_id, emoji=src.emoji, custom_emoji_id=src.custom_emoji_id,
        media_id=src.media_id, status=ProductStatus.DRAFT, stock_mode=src.stock_mode, delivery_mode=src.delivery_mode,
        fulfillment_config=src.fulfillment_config, warranty=src.warranty, delivery_instructions=src.delivery_instructions,
        min_quantity=src.min_quantity, max_quantity=src.max_quantity, max_per_customer=src.max_per_customer,
        regions=src.regions, languages=src.languages, option_groups=src.option_groups, tags=src.tags,
        sort_order=src.sort_order + 1, low_stock_threshold=src.low_stock_threshold,
    )
    copy.variants = [ProductVariant(sku=f"{v.sku[:50]}-C{random_code(4)}", name=v.name, attributes=v.attributes,
                                    price=v.price, old_price=v.old_price, cost_price=v.cost_price, sort_order=v.sort_order,
                                    is_active=v.is_active, is_default=v.is_default, delivery_mode=v.delivery_mode,
                                    instructions=v.instructions, fulfillment_config=v.fulfillment_config)
                     for v in src.variants]
    session.add(copy)
    await session.flush()
    await audit(session, auth.admin, "product.duplicate", f"Duplicated {i18n_get(src.name, 'en')}", entity_type="product",
                entity_id=copy.id)
    return {"id": copy.id}


@router.delete("/products/{product_id}")
async def delete_product(product_id: int, session: DB, auth: Perm("products.delete")) -> dict[str, str]:
    p = await _load_product(session, product_id)
    p.deleted_at = utcnow()
    p.status = ProductStatus.ARCHIVED
    p.slug = f"{p.slug}-deleted-{p.id}"[:120]
    await audit(session, auth.admin, "product.delete", f"Deleted product {i18n_get(p.name, 'en')}", entity_type="product",
                entity_id=p.id)
    _invalidate_content(session)
    return {"status": "ok"}


@router.post("/products/reorder")
async def reorder_products(body: ReorderIn, session: DB, auth: Perm("products.edit")) -> dict[str, str]:
    prods = {p.id: p for p in (await session.execute(select(Product).where(Product.id.in_(body.ids)))).scalars()}
    for i, pid in enumerate(body.ids):
        if pid in prods:
            prods[pid].sort_order = i
    await audit(session, auth.admin, "product.reorder", "Reordered products")
    return {"status": "ok"}


class BulkStatusIn(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=1000)
    status: ProductStatus


@router.post("/products/bulk-status")
async def bulk_status(body: BulkStatusIn, session: DB, auth: Perm("products.edit")) -> dict[str, int]:
    prods = (await session.execute(select(Product).where(Product.id.in_(body.ids), Product.deleted_at.is_(None)))).scalars().all()
    for p in prods:
        p.status = body.status
    await audit(session, auth.admin, "product.bulk_status", f"Set {len(prods)} product(s) to {body.status.value}")
    return {"updated": len(prods)}
