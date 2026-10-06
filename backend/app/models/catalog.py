"""Catalog: categories, products, variants, reviews."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Money, SoftDeleteMixin, TimestampMixin, enum_col
from app.models.enums import DeliveryMode, ProductStatus, ReviewStatus, StockMode


class Category(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), index=True)
    slug: Mapped[str] = mapped_column(String(96), unique=True)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    description: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    emoji: Mapped[str | None] = mapped_column(String(32))
    custom_emoji_id: Mapped[str | None] = mapped_column(String(32))
    media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    parent: Mapped[Category | None] = relationship(remote_side="Category.id", lazy="joined", join_depth=1)


class Product(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint("min_quantity >= 1", name="min_qty_positive"),
        Index("ix_products_status_sort", "status", "sort_order"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"), index=True)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    short_description: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    description: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    emoji: Mapped[str | None] = mapped_column(String(32))
    custom_emoji_id: Mapped[str | None] = mapped_column(String(32))
    media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"))
    status: Mapped[ProductStatus] = mapped_column(enum_col(ProductStatus), default=ProductStatus.DRAFT)
    currency: Mapped[str | None] = mapped_column(String(8))  # None → store currency
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_featured: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String(48)), default=list, server_default="{}")

    stock_mode: Mapped[StockMode] = mapped_column(enum_col(StockMode), default=StockMode.INVENTORY)
    delivery_mode: Mapped[DeliveryMode] = mapped_column(enum_col(DeliveryMode), default=DeliveryMode.INVENTORY)
    # Delivery configuration (static text, file media id, API/webhook endpoint…). Secrets encrypted.
    fulfillment_config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    warranty: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    delivery_instructions: Mapped[dict[str, str] | None] = mapped_column(JSONB)

    min_quantity: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    max_quantity: Mapped[int | None] = mapped_column(Integer)
    max_per_customer: Mapped[int | None] = mapped_column(Integer)
    regions: Mapped[list[str]] = mapped_column(ARRAY(String(8)), default=list, server_default="{}")
    languages: Mapped[list[str]] = mapped_column(ARRAY(String(8)), default=list, server_default="{}")
    # Variant option groups: [{"key": "plan", "name": {"en": "Plan"}}, …]
    option_groups: Mapped[list[Any]] = mapped_column(JSONB, default=list, server_default="[]")
    seo: Mapped[dict[str, Any] | None] = mapped_column(JSONB)

    views_count: Mapped[int] = mapped_column(default=0, server_default="0")
    sold_count: Mapped[int] = mapped_column(default=0, server_default="0")
    rating_avg: Mapped[Decimal | None] = mapped_column(Money)
    rating_count: Mapped[int] = mapped_column(default=0, server_default="0")
    low_stock_threshold: Mapped[int] = mapped_column(Integer, default=5, server_default="5")

    category: Mapped[Category | None] = relationship(lazy="joined")
    variants: Mapped[list[ProductVariant]] = relationship(
        back_populates="product",
        lazy="selectin",
        order_by="ProductVariant.sort_order",
        cascade="all, delete-orphan",
    )


class ProductVariant(Base, TimestampMixin):
    __tablename__ = "product_variants"
    __table_args__ = (
        CheckConstraint("price >= 0", name="price_non_negative"),
        Index("ix_product_variants_product", "product_id", "sort_order"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    sku: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    # Option values: {"plan": "Plus", "duration": "1 month"}
    attributes: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict, server_default="{}")
    price: Mapped[Decimal] = mapped_column(Money)
    old_price: Mapped[Decimal | None] = mapped_column(Money)
    cost_price: Mapped[Decimal | None] = mapped_column(Money)
    manual_stock: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Optional per-variant overrides
    delivery_mode: Mapped[DeliveryMode | None] = mapped_column(enum_col(DeliveryMode), nullable=True)
    fulfillment_config: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    instructions: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    product: Mapped[Product] = relationship(back_populates="variants")


class Review(Base, TimestampMixin):
    __tablename__ = "reviews"
    __table_args__ = (
        UniqueConstraint("user_id", "order_id", "product_id"),
        CheckConstraint("rating BETWEEN 1 AND 5", name="rating_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    rating: Mapped[int] = mapped_column(SmallInteger)
    text: Mapped[str | None] = mapped_column(Text)
    status: Mapped[ReviewStatus] = mapped_column(enum_col(ReviewStatus), default=ReviewStatus.PENDING, index=True)
    admin_reply: Mapped[str | None] = mapped_column(Text)


class Media(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "media"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    storage_key: Mapped[str] = mapped_column(String(255), unique=True)
    original_name: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(255))
    folder: Mapped[str] = mapped_column(String(96), default="", server_default="", index=True)
    mime_type: Mapped[str] = mapped_column(String(96))
    kind: Mapped[str] = mapped_column(String(16), index=True)
    size: Mapped[int] = mapped_column()
    width: Mapped[int | None] = mapped_column(Integer)
    height: Mapped[int | None] = mapped_column(Integer)
    duration: Mapped[int | None] = mapped_column(Integer)
    checksum: Mapped[str] = mapped_column(String(64), index=True)
    # Telegram file_id cache (valid per bot) — avoids re-uploading files
    telegram_file_id: Mapped[str | None] = mapped_column(String(255))
    telegram_bot_id: Mapped[int | None] = mapped_column()
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")


class Banner(Base, TimestampMixin):
    """Banner per placement & language (language NULL = all languages)."""

    __tablename__ = "banners"
    __table_args__ = (
        UniqueConstraint("placement", "language", postgresql_nulls_not_distinct=True),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    placement: Mapped[str] = mapped_column(String(32))
    language: Mapped[str | None] = mapped_column(String(8))
    media_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("media.id", ondelete="CASCADE"))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    media: Mapped[Media] = relationship(lazy="joined")
