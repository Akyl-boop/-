"""Telegram customers, CRM (tags, notes, timeline), balance, referrals."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, Money, TimestampMixin, enum_col
from app.models.enums import BalanceTxType

user_tags = Table(
    "user_tags",
    Base.metadata,
    Column("user_id", ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("customer_tags.id", ondelete="CASCADE"), primary_key=True),
)


class CustomerTag(Base, TimestampMixin):
    __tablename__ = "customer_tags"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(48), unique=True)
    color: Mapped[str] = mapped_column(String(16), default="#8b5cf6")
    description: Mapped[str | None] = mapped_column(String(255))


class User(Base, TimestampMixin):
    """A Telegram customer."""

    __tablename__ = "users"
    __table_args__ = (CheckConstraint("balance >= 0", name="balance_non_negative"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[int] = mapped_column(unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(64), index=True)
    first_name: Mapped[str | None] = mapped_column(String(128))
    last_name: Mapped[str | None] = mapped_column(String(128))
    language_code: Mapped[str | None] = mapped_column(String(16))  # from Telegram
    language: Mapped[str] = mapped_column(String(8), default="en", server_default="en")  # chosen
    is_premium: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", index=True)
    ban_reason: Mapped[str | None] = mapped_column(String(255))
    bot_blocked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    balance: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    referral_code: Mapped[str] = mapped_column(String(16), unique=True)
    referred_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    start_param: Mapped[str | None] = mapped_column(String(64))

    # Denormalised counters (maintained by order/payment services)
    total_spent: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    orders_count: Mapped[int] = mapped_column(default=0, server_default="0")
    paid_orders_count: Mapped[int] = mapped_column(default=0, server_default="0")
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    first_order_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    tags: Mapped[list[CustomerTag]] = relationship(secondary=user_tags, lazy="selectin")

    @property
    def display_name(self) -> str:
        name = " ".join(p for p in (self.first_name, self.last_name) if p)
        return name or (f"@{self.username}" if self.username else f"User {self.telegram_id}")


class CustomerNote(Base):
    __tablename__ = "customer_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CustomerEvent(Base):
    """CRM timeline entry."""

    __tablename__ = "customer_events"
    __table_args__ = (Index("ix_customer_events_user_created", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(48))
    message: Mapped[str] = mapped_column(String(500))
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BalanceTransaction(Base):
    __tablename__ = "balance_transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(Money)
    balance_after: Mapped[Decimal] = mapped_column(Money)
    type: Mapped[BalanceTxType] = mapped_column(enum_col(BalanceTxType))
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"), index=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class Referral(Base):
    __tablename__ = "referrals"

    id: Mapped[int] = mapped_column(primary_key=True)
    referrer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    referred_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    first_order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    revenue: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    reward_total: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"), server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    referrer: Mapped[User] = relationship(foreign_keys=[referrer_id], lazy="joined")
    referred: Mapped[User] = relationship(foreign_keys=[referred_id], lazy="joined")


class ReferralReward(Base):
    __tablename__ = "referral_rewards"
    __table_args__ = (UniqueConstraint("referral_id", "order_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    referral_id: Mapped[int] = mapped_column(ForeignKey("referrals.id", ondelete="CASCADE"), index=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"))
    amount: Mapped[Decimal] = mapped_column(Money)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Favorite(Base):
    __tablename__ = "favorites"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ProductView(Base):
    """Recently viewed products (one row per user/product, updated on each view)."""

    __tablename__ = "product_views"
    __table_args__ = (Index("ix_product_views_user_viewed", "user_id", "viewed_at"),)

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), primary_key=True)
    viewed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    views: Mapped[int] = mapped_column(default=1, server_default="1")


class RestockSubscription(Base):
    """'Notify me when back in stock' subscriptions."""

    __tablename__ = "restock_subscriptions"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
