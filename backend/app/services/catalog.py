"""Catalog queries shared by the bot and the admin API (stock, visibility, search, recommendations)."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from sqlalchemy import and_, any_, func, literal, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.models import Category, InventoryItem, OrderItem, Product, ProductVariant
from app.models.enums import InventoryStatus, ProductStatus, StockMode

STOREFRONT_STATUSES = (ProductStatus.ACTIVE, ProductStatus.OUT_OF_STOCK)


@dataclass
class VariantView:
    variant: ProductVariant
    stock: int | None  # None = unlimited

    @property
    def available(self) -> bool:
        return self.variant.is_active and (self.stock is None or self.stock > 0)


async def inventory_counts(session: AsyncSession, variant_ids: list[int]) -> dict[int, int]:
    if not variant_ids:
        return {}
    rows = await session.execute(
        select(InventoryItem.variant_id, func.count())
        .where(InventoryItem.variant_id.in_(variant_ids), InventoryItem.status == InventoryStatus.AVAILABLE)
        .group_by(InventoryItem.variant_id)
    )
    return {vid: int(c) for vid, c in rows.all()}


async def stock_map(session: AsyncSession, products: list[Product]) -> dict[int, int | None]:
    """variant_id → available stock (None = unlimited). One query for all products (no N+1)."""
    inv_ids = [v.id for p in products if p.stock_mode == StockMode.INVENTORY for v in p.variants]
    counts = await inventory_counts(session, inv_ids)
    out: dict[int, int | None] = {}
    for p in products:
        for v in p.variants:
            if p.stock_mode == StockMode.UNLIMITED:
                out[v.id] = None
            elif p.stock_mode == StockMode.MANUAL:
                out[v.id] = max(0, v.manual_stock)
            else:
                out[v.id] = counts.get(v.id, 0)
    return out


def product_stock(product: Product, stocks: dict[int, int | None]) -> int | None:
    values = [stocks.get(v.id, 0) for v in product.variants if v.is_active]
    if not values:
        return 0
    if any(v is None for v in values):
        return None
    return sum(v or 0 for v in values)


def price_range(product: Product) -> tuple[Decimal, Decimal]:
    prices = [v.price for v in product.variants if v.is_active] or [Decimal("0")]
    return min(prices), max(prices)


def lang_filter(lang: str) -> Any:
    return or_(func.cardinality(Product.languages) == 0, literal(lang) == any_(Product.languages))


async def visible_categories(session: AsyncSession, parent_id: int | None, lang: str) -> list[tuple[Category, int]]:
    """Visible categories with count of visible products (including direct sub-categories)."""
    prod_count = (
        select(func.count(Product.id))
        .where(
            Product.category_id == Category.id,
            Product.status.in_(STOREFRONT_STATUSES),
            Product.deleted_at.is_(None),
            lang_filter(lang),
        )
        .correlate(Category)
        .scalar_subquery()
    )
    child = aliased(Category)
    child_count = (
        select(func.count(child.id))
        .where(child.parent_id == Category.id, child.is_visible.is_(True), child.deleted_at.is_(None))
        .correlate(Category)
        .scalar_subquery()
    )
    cond = Category.parent_id.is_(None) if parent_id is None else Category.parent_id == parent_id
    rows = await session.execute(
        select(Category, prod_count, child_count)
        .where(cond, Category.is_visible.is_(True), Category.deleted_at.is_(None))
        .order_by(Category.sort_order, Category.id)
    )
    return [(c, int(n) + int(ch)) for c, n, ch in rows.all() if int(n) + int(ch) > 0]


async def storefront_products(
    session: AsyncSession, *, category_id: int | None = None, lang: str = "en", ids: list[int] | None = None,
    limit: int | None = None, offset: int = 0, featured: bool | None = None,
) -> tuple[list[Product], int]:
    conds = [Product.status.in_(STOREFRONT_STATUSES), Product.deleted_at.is_(None), lang_filter(lang)]
    if category_id is not None:
        conds.append(Product.category_id == category_id)
    if ids is not None:
        conds.append(Product.id.in_(ids))
    if featured is not None:
        conds.append(Product.is_featured.is_(featured))
    total = (await session.execute(select(func.count()).select_from(Product).where(*conds))).scalar_one()
    q = select(Product).where(*conds).order_by(Product.sort_order, Product.id).offset(offset)
    if limit:
        q = q.limit(limit)
    products = list((await session.execute(q.options(selectinload(Product.variants)))).scalars().unique())
    return products, int(total)


async def get_storefront_product(session: AsyncSession, product_id: int, lang: str) -> Product | None:
    p = (
        await session.execute(
            select(Product)
            .where(Product.id == product_id, Product.deleted_at.is_(None), Product.status.in_(STOREFRONT_STATUSES))
            .options(selectinload(Product.variants))
        )
    ).scalar_one_or_none()
    if p is None:
        return None
    if p.languages and lang not in p.languages:
        return None
    return p


async def search_products(session: AsyncSession, query: str, lang: str, limit: int = 10) -> list[Product]:
    """Fuzzy product search (pg_trgm word similarity over names, descriptions and tags)."""
    q = query.strip()[:64]
    if not q:
        return []
    haystack = func.concat_ws(
        " ",
        Product.name.op("->>")(lang),
        Product.name.op("->>")("en"),
        Product.short_description.op("->>")(lang),
        func.array_to_string(Product.tags, " "),
        Product.slug,
    )
    score = func.word_similarity(q, haystack)
    rows = await session.execute(
        select(Product)
        .where(
            Product.status.in_(STOREFRONT_STATUSES),
            Product.deleted_at.is_(None),
            lang_filter(lang),
            or_(haystack.ilike(f"%{q}%"), score > 0.3),
        )
        .order_by(score.desc(), Product.sold_count.desc())
        .limit(limit)
        .options(selectinload(Product.variants))
    )
    return list(rows.scalars().unique())


async def recommendations(session: AsyncSession, product: Product, lang: str, limit: int = 3) -> list[Product]:
    """'Customers also bought' first, then best sellers from the same category."""
    co_orders = select(OrderItem.order_id).where(OrderItem.product_id == product.id).limit(500).subquery()
    co = await session.execute(
        select(OrderItem.product_id, func.count().label("n"))
        .where(OrderItem.order_id.in_(select(co_orders.c.order_id)), OrderItem.product_id != product.id)
        .group_by(OrderItem.product_id)
        .order_by(text("n DESC"))
        .limit(limit)
    )
    ids = [pid for pid, _ in co.all() if pid]
    result: list[Product] = []
    if ids:
        prods, _ = await storefront_products(session, ids=ids, lang=lang)
        result = sorted(prods, key=lambda p: ids.index(p.id))
    if len(result) < limit:
        conds = [
            Product.status == ProductStatus.ACTIVE,
            Product.deleted_at.is_(None),
            Product.id != product.id,
            lang_filter(lang),
            Product.id.notin_([p.id for p in result] or [0]),
        ]
        if product.category_id:
            conds.append(Product.category_id == product.category_id)
        more = await session.execute(
            select(Product).where(and_(*conds)).order_by(Product.sold_count.desc(), Product.sort_order)
            .limit(limit - len(result)).options(selectinload(Product.variants))
        )
        result.extend(more.scalars().unique())
    return result


async def refresh_out_of_stock_status(session: AsyncSession, product_ids: list[int]) -> list[tuple[Product, int | None, str]]:
    """Flip ACTIVE ↔ OUT_OF_STOCK according to stock. Returns (product, stock, transition) for changed products."""
    if not product_ids:
        return []
    products = list(
        (await session.execute(select(Product).where(Product.id.in_(product_ids)).options(selectinload(Product.variants))))
        .scalars().unique()
    )
    stocks = await stock_map(session, products)
    changed = []
    for p in products:
        stock = product_stock(p, stocks)
        if p.status == ProductStatus.ACTIVE and stock == 0:
            p.status = ProductStatus.OUT_OF_STOCK
            changed.append((p, stock, "out"))
        elif p.status == ProductStatus.OUT_OF_STOCK and (stock is None or stock > 0):
            p.status = ProductStatus.ACTIVE
            changed.append((p, stock, "in"))
    return changed
