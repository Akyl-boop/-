"""Inventory, carts, orders, payments, promo codes, refunds."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, CryptoAmount, Money, TimestampMixin, enum_col
from app.models.catalog import Product, ProductVariant
from app.models.customer import User
from app.models.enums import (
    DeliveryMode,
    DeliveryStatus,
    InventoryKind,
    InventoryStatus,
    OrderStatus,
    PaymentStatus,
    PromoType,
)

# ─── Inventory ──────────────────────────────────────────────────────────────


class InventoryItem(Base, TimestampMixin):
    __tablename__ = "inventory"
    __table_args__ = (
        Index("ix_inventory_variant_status", "variant_id", "status"),
        # The same secret cannot be loaded twice into the same variant
        UniqueConstraint("variant_id", "content_hash", name="uq_inventory_variant_hash"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"))
    kind: Mapped[InventoryKind] = mapped_column(enum_col(InventoryKind), default=InventoryKind.CODE)
    content_enc: Mapped[str] = mapped_column(Text)  # encrypted at rest
    content_hash: Mapped[str] = mapped_column(String(64))
    preview: Mapped[str] = mapped_column(String(32))  # masked preview for the dashboard
    media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"))
    status: Mapped[InventoryStatus] = mapped_column(
        enum_col(InventoryStatus), default=InventoryStatus.AVAILABLE, index=True
    )
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    order_item_id: Mapped[int | None] = mapped_column(ForeignKey("order_items.id", ondelete="SET NULL"))
    reserved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    batch: Mapped[str | None] = mapped_column(String(64), index=True)
    note: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))

    variant: Mapped[ProductVariant] = relationship(lazy="joined")


class InventoryEvent(Base):
    """Stock history."""

    __tablename__ = "inventory_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), index=True)
    variant_id: Mapped[int | None] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"))
    item_id: Mapped[int | None] = mapped_column(ForeignKey("inventory.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(32))
    quantity: Mapped[int] = mapped_column(Integer)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


# ─── Promo codes ────────────────────────────────────────────────────────────


class PromoCode(Base, TimestampMixin):
    __tablename__ = "promo_codes"
    __table_args__ = (CheckConstraint("value > 0", name="value_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(48), unique=True)
    description: Mapped[str | None] = mapped_column(String(255))
    type: Mapped[PromoType] = mapped_column(enum_col(PromoType))
    value: Mapped[Decimal] = mapped_column(Money)
    max_discount: Mapped[Decimal | None] = mapped_column(Money)
    min_purchase: Mapped[Decimal | None] = mapped_column(Money)
    max_uses: Mapped[int | None] = mapped_column(Integer)
    max_uses_per_user: Mapped[int | None] = mapped_column(Integer)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    product_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=list, server_default="{}")
    category_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=list, server_default="{}")
    user_ids: Mapped[list[int]] = mapped_column(ARRAY(Integer), default=list, server_default="{}")
    new_customers_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    uses_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class PromoUsage(Base):
    __tablename__ = "promo_usage"
    __table_args__ = (UniqueConstraint("promo_id", "order_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    promo_id: Mapped[int] = mapped_column(ForeignKey("promo_codes.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    discount: Mapped[Decimal] = mapped_column(Money)
    order_total: Mapped[Decimal] = mapped_column(Money)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── Cart ───────────────────────────────────────────────────────────────────


class Cart(Base, TimestampMixin):
    __tablename__ = "carts"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    promo_code_id: Mapped[int | None] = mapped_column(ForeignKey("promo_codes.id", ondelete="SET NULL"))
    use_balance: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    items: Mapped[list[CartItem]] = relationship(
        back_populates="cart", lazy="selectin", cascade="all, delete-orphan", order_by="CartItem.id"
    )
    promo_code: Mapped[PromoCode | None] = relationship(lazy="joined")


class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (
        UniqueConstraint("cart_id", "variant_id"),
        CheckConstraint("quantity > 0", name="qty_positive"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cart_id: Mapped[int] = mapped_column(ForeignKey("carts.id", ondelete="CASCADE"))
    variant_id: Mapped[int] = mapped_column(ForeignKey("product_variants.id", ondelete="CASCADE"))
    quantity: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    cart: Mapped[Cart] = relationship(back_populates="items")
    variant: Mapped[ProductVariant] = relationship(lazy="joined")


# ─── Orders ─────────────────────────────────────────────────────────────────


class Order(Base, TimestampMixin):
    __tablename__ = "orders"
    __table_args__ = (
        CheckConstraint("total >= 0", name="total_non_negative"),
        Index("ix_orders_status_created", "status", "created_at"),
        Index("ix_orders_paid_at", "paid_at"),
        Index("ix_orders_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(32), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    status: Mapped[OrderStatus] = mapped_column(enum_col(OrderStatus), default=OrderStatus.PENDING)
    delivery_status: Mapped[DeliveryStatus] = mapped_column(
        enum_col(DeliveryStatus), default=DeliveryStatus.PENDING
    )
    currency: Mapped[str] = mapped_column(String(8))
    subtotal: Mapped[Decimal] = mapped_column(Money)
    discount_total: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    balance_used: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    total: Mapped[Decimal] = mapped_column(Money)
    cost_total: Mapped[Decimal | None] = mapped_column(Money)
    refunded_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    promo_code_id: Mapped[int | None] = mapped_column(ForeignKey("promo_codes.id", ondelete="SET NULL"))
    promo_code: Mapped[str | None] = mapped_column(String(48))
    payment_method: Mapped[str | None] = mapped_column(String(48), index=True)
    language: Mapped[str] = mapped_column(String(8), default="en")
    admin_notes: Mapped[str | None] = mapped_column(Text)
    customer_note: Mapped[str | None] = mapped_column(String(500))
    source: Mapped[str] = mapped_column(String(16), default="bot", server_default="bot")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bot_message_id: Mapped[int | None] = mapped_column()  # message showing the payment screen

    user: Mapped[User] = relationship(lazy="joined")
    items: Mapped[list[OrderItem]] = relationship(
        back_populates="order", lazy="selectin", cascade="all, delete-orphan", order_by="OrderItem.id"
    )
    payments: Mapped[list[Payment]] = relationship(
        back_populates="order", lazy="selectin", order_by="Payment.created_at"
    )


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (CheckConstraint("quantity > 0", name="qty_positive"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="SET NULL"), index=True)
    variant_id: Mapped[int | None] = mapped_column(ForeignKey("product_variants.id", ondelete="SET NULL"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="SET NULL"))
    product_name: Mapped[str] = mapped_column(String(255))
    variant_name: Mapped[str | None] = mapped_column(String(255))
    sku: Mapped[str | None] = mapped_column(String(64))
    unit_price: Mapped[Decimal] = mapped_column(Money)
    unit_cost: Mapped[Decimal | None] = mapped_column(Money)
    quantity: Mapped[int] = mapped_column(Integer)
    discount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    total: Mapped[Decimal] = mapped_column(Money)
    delivery_mode: Mapped[DeliveryMode] = mapped_column(enum_col(DeliveryMode))
    delivered_quantity: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Exact delivered payload (encrypted JSON list of strings / file references)
    delivery_data_enc: Mapped[str | None] = mapped_column(Text)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    order: Mapped[Order] = relationship(back_populates="items")
    product: Mapped[Product | None] = relationship(lazy="raise")


class OrderEvent(Base):
    """Order activity timeline."""

    __tablename__ = "order_events"
    __table_args__ = (Index("ix_order_events_order_created", "order_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(48))
    message: Mapped[str] = mapped_column(String(500))
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    actor: Mapped[str] = mapped_column(String(16), default="system")
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── Payments ───────────────────────────────────────────────────────────────


class PaymentMethod(Base, TimestampMixin):
    """A configured payment option shown to customers (provider + configuration)."""

    __tablename__ = "payment_methods"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(48), unique=True)
    provider: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[dict[str, str]] = mapped_column(JSONB)
    description: Mapped[dict[str, str] | None] = mapped_column(JSONB)
    emoji: Mapped[str | None] = mapped_column(String(32))
    custom_emoji_id: Mapped[str | None] = mapped_column(String(32))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # Non-secret settings (network, confirmations, expiry, instructions…)
    public_config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    # Secrets (API tokens, keys) — Fernet-encrypted JSON, never sent to the frontend
    secret_config_enc: Mapped[str | None] = mapped_column(Text)
    min_amount: Mapped[Decimal | None] = mapped_column(Money)
    max_amount: Mapped[Decimal | None] = mapped_column(Money)
    fee_percent: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    last_health_ok: Mapped[bool | None] = mapped_column(Boolean)
    last_health_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_health_error: Mapped[str | None] = mapped_column(String(500))


class Payment(Base, TimestampMixin):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("provider", "external_id", name="uq_payments_provider_external"),
        # A blockchain transaction can only ever pay one payment.
        Index("uq_payments_tx_hash", "network", "tx_hash", unique=True, postgresql_where=text("tx_hash IS NOT NULL")),
        Index("ix_payments_status_created", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    reference: Mapped[str] = mapped_column(String(32), unique=True)  # human/short reference (memo)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    method_code: Mapped[str] = mapped_column(String(48))
    provider: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[PaymentStatus] = mapped_column(enum_col(PaymentStatus), default=PaymentStatus.PENDING)
    amount: Mapped[Decimal] = mapped_column(Money)  # in store currency
    currency: Mapped[str] = mapped_column(String(8))
    pay_amount: Mapped[Decimal | None] = mapped_column(CryptoAmount)  # in payment currency
    pay_currency: Mapped[str | None] = mapped_column(String(16))
    network: Mapped[str | None] = mapped_column(String(16))
    address: Mapped[str | None] = mapped_column(String(128), index=True)
    memo: Mapped[str | None] = mapped_column(String(64))
    pay_url: Mapped[str | None] = mapped_column(String(500))
    external_id: Mapped[str | None] = mapped_column(String(128))
    tx_hash: Mapped[str | None] = mapped_column(String(128))
    confirmations: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    received_amount: Mapped[Decimal | None] = mapped_column(CryptoAmount)
    refunded_amount: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(String(500))
    extra: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")

    order: Mapped[Order] = relationship(back_populates="payments")


class Refund(Base):
    __tablename__ = "refunds"

    id: Mapped[int] = mapped_column(primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), index=True)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("payments.id", ondelete="SET NULL"))
    amount: Mapped[Decimal] = mapped_column(Money)
    method: Mapped[str] = mapped_column(String(16))  # provider | balance | manual
    reason: Mapped[str | None] = mapped_column(String(500))
    external_id: Mapped[str | None] = mapped_column(String(128))
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CryptoAddress(Base, TimestampMixin):
    """Optional pool of pre-generated receiving addresses (one active payment per address)."""

    __tablename__ = "crypto_addresses"
    __table_args__ = (UniqueConstraint("network", "address"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    network: Mapped[str] = mapped_column(String(16), index=True)
    address: Mapped[str] = mapped_column(String(128))
    label: Mapped[str | None] = mapped_column(String(64))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    assigned_payment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("payments.id", ondelete="SET NULL"), unique=True
    )
    assigned_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
