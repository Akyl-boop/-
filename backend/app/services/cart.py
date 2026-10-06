"""Persistent shopping cart (stored in PostgreSQL — survives restarts)."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.errors import OutOfStock, PromoError, ValidationFailed
from app.core.utils import money
from app.models import Cart, CartItem, Product, ProductVariant, User
from app.models.enums import ProductStatus
from app.services.catalog import stock_map
from app.services.promo import PricedLine, find_promo, validate_promo
from app.services.settings import settings_store


@dataclass
class CartLine:
    item_id: int
    product: Product
    variant: ProductVariant
    quantity: int
    unit_price: Decimal
    stock: int | None

    @property
    def total(self) -> Decimal:
        return money(self.unit_price * self.quantity)


@dataclass
class CartSummary:
    lines: list[CartLine] = field(default_factory=list)
    subtotal: Decimal = Decimal("0")
    discount: Decimal = Decimal("0")
    promo_code: str | None = None
    promo_error: str | None = None
    balance_applied: Decimal = Decimal("0")
    total: Decimal = Decimal("0")
    removed_unavailable: bool = False

    @property
    def count(self) -> int:
        return sum(line.quantity for line in self.lines)


async def get_cart(session: AsyncSession, user_id: int, create: bool = True) -> Cart | None:
    cart = (await session.execute(select(Cart).where(Cart.user_id == user_id))).scalar_one_or_none()
    if cart is None and create:
        cart = Cart(user_id=user_id)
        session.add(cart)
        await session.flush()
        await session.refresh(cart, ["items"])
    return cart


async def cart_count(session: AsyncSession, user_id: int) -> int:
    cart = await get_cart(session, user_id, create=False)
    return sum(i.quantity for i in cart.items) if cart else 0


def _purchasable(product: Product, variant: ProductVariant) -> bool:
    return (
        product.deleted_at is None
        and product.status in (ProductStatus.ACTIVE, ProductStatus.OUT_OF_STOCK)
        and variant.is_active
    )


async def add_item(session: AsyncSession, user: User, variant_id: int, quantity: int = 1) -> Cart:
    variant = (
        await session.execute(
            select(ProductVariant).where(ProductVariant.id == variant_id)
            .options(selectinload(ProductVariant.product).selectinload(Product.variants))
        )
    ).scalar_one_or_none()
    if variant is None or not _purchasable(variant.product, variant):
        raise ValidationFailed("Product unavailable", code="error.not_found")
    product = variant.product
    cart = await get_cart(session, user.id)
    assert cart is not None
    existing = next((i for i in cart.items if i.variant_id == variant_id), None)
    new_qty = (existing.quantity if existing else 0) + quantity
    new_qty = max(new_qty, product.min_quantity)
    if product.max_quantity and new_qty > product.max_quantity:
        raise ValidationFailed("Limit reached", code="product.limit_reached")
    stocks = await stock_map(session, [product])
    stock = stocks.get(variant.id)
    if stock is not None and new_qty > stock:
        raise OutOfStock("Not enough stock", code="product.out_of_stock")
    max_items = int(await settings_store.get("checkout.max_cart_items", 20))
    if existing is None and len(cart.items) >= max_items:
        raise ValidationFailed("Cart is full", code="product.limit_reached")
    if existing:
        existing.quantity = new_qty
    else:
        cart.items.append(CartItem(variant_id=variant_id, quantity=new_qty))
    await session.flush()
    return cart


async def set_quantity(session: AsyncSession, user: User, item_id: int, quantity: int) -> None:
    cart = await get_cart(session, user.id)
    assert cart is not None
    item = next((i for i in cart.items if i.id == item_id), None)
    if item is None:
        return
    if quantity <= 0:
        cart.items.remove(item)
        await session.delete(item)
    else:
        product = (await session.execute(select(Product).where(Product.id == item.variant.product_id))).scalar_one()
        if quantity < product.min_quantity:
            quantity = product.min_quantity
        if product.max_quantity and quantity > product.max_quantity:
            raise ValidationFailed("Limit reached", code="product.limit_reached")
        stock = (await stock_map(session, [product])).get(item.variant_id)
        if stock is not None and quantity > stock:
            raise OutOfStock("Not enough stock", code="product.out_of_stock")
        item.quantity = quantity
    await session.flush()


async def clear(session: AsyncSession, user_id: int) -> None:
    cart = await get_cart(session, user_id, create=False)
    if cart is None:
        return
    await session.execute(delete(CartItem).where(CartItem.cart_id == cart.id))
    cart.promo_code_id = None
    cart.use_balance = False
    await session.flush()
    session.expire(cart, ["items"])


async def apply_promo(session: AsyncSession, user: User, code: str) -> CartSummary:
    cart = await get_cart(session, user.id)
    assert cart is not None
    promo = await find_promo(session, code)
    summary = await summarize(session, user, cart, check_promo=False)
    lines = [PricedLine(line.product.id, line.product.category_id, line.total) for line in summary.lines]
    result = await validate_promo(session, promo, user, lines)
    cart.promo_code_id = result.promo.id
    await session.flush()
    return await summarize(session, user, cart)


async def remove_promo(session: AsyncSession, user: User) -> None:
    cart = await get_cart(session, user.id)
    if cart:
        cart.promo_code_id = None
        await session.flush()


async def summarize(session: AsyncSession, user: User, cart: Cart | None = None, *, check_promo: bool = True) -> CartSummary:
    cart = cart or await get_cart(session, user.id)
    summary = CartSummary()
    if cart is None or not cart.items:
        return summary
    variant_ids = [i.variant_id for i in cart.items]
    variants = {
        v.id: v
        for v in (
            await session.execute(
                select(ProductVariant).where(ProductVariant.id.in_(variant_ids))
                .options(selectinload(ProductVariant.product).selectinload(Product.variants))
            )
        ).scalars()
    }
    products = list({v.product.id: v.product for v in variants.values()}.values())
    stocks = await stock_map(session, products)
    for item in list(cart.items):
        v = variants.get(item.variant_id)
        if v is None or not _purchasable(v.product, v):
            cart.items.remove(item)
            await session.delete(item)
            summary.removed_unavailable = True
            continue
        summary.lines.append(CartLine(item.id, v.product, v, item.quantity, v.price, stocks.get(v.id)))
    summary.subtotal = money(sum((line.total for line in summary.lines), Decimal("0")))
    if check_promo and cart.promo_code_id and await settings_store.feature("promo_codes"):
        promo = cart.promo_code
        try:
            lines = [PricedLine(line.product.id, line.product.category_id, line.total) for line in summary.lines]
            res = await validate_promo(session, promo, user, lines)
            summary.discount = res.discount
            summary.promo_code = res.promo.code
        except PromoError as exc:
            summary.promo_error = exc.code
            cart.promo_code_id = None
    after_discount = summary.subtotal - summary.discount
    if cart.use_balance and await settings_store.feature("balance") and user.balance > 0:
        summary.balance_applied = money(min(user.balance, after_discount))
    summary.total = money(max(Decimal("0"), after_discount - summary.balance_applied))
    if summary.removed_unavailable:
        await session.flush()
    return summary
