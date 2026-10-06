"""Content (texts, menus, pages), support, broadcasts, notifications, audit, webhooks, settings."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, enum_col
from app.models.customer import User
from app.models.enums import BroadcastStatus, RecipientStatus, TicketPriority, TicketStatus

# ─── Settings & localisation ────────────────────────────────────────────────


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSONB)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))


class Language(Base):
    __tablename__ = "languages"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    name: Mapped[str] = mapped_column(String(64))
    native_name: Mapped[str] = mapped_column(String(64))
    flag: Mapped[str] = mapped_column(String(16), default="🏳️")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class Translation(Base):
    """Override of a bot text key for a language. Defaults live in code (app/localization)."""

    __tablename__ = "translations"
    __table_args__ = (UniqueConstraint("key", "lang"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(96), index=True)
    lang: Mapped[str] = mapped_column(String(8))
    value: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))


class MenuButton(Base, TimestampMixin):
    """Database-driven inline keyboard menus (menu builder)."""

    __tablename__ = "menu_buttons"
    __table_args__ = (Index("ix_menu_buttons_menu_pos", "menu", "row", "position"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    menu: Mapped[str] = mapped_column(String(32), default="main")
    label: Mapped[dict[str, str]] = mapped_column(JSONB)
    emoji: Mapped[str | None] = mapped_column(String(32))
    custom_emoji_id: Mapped[str | None] = mapped_column(String(32))
    style: Mapped[str | None] = mapped_column(String(16))  # Bot API button style: primary|success|danger
    action: Mapped[str] = mapped_column(String(24))
    action_value: Mapped[str | None] = mapped_column(String(500))
    row: Mapped[int] = mapped_column(Integer, default=0)
    position: Mapped[int] = mapped_column(Integer, default=0)
    visible: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    languages: Mapped[list[str]] = mapped_column(ARRAY(String(8)), default=list, server_default="{}")


class Page(Base, TimestampMixin):
    """Custom bot pages (terms, help, about, custom content)."""

    __tablename__ = "pages"

    id: Mapped[int] = mapped_column(primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True)
    title: Mapped[dict[str, str]] = mapped_column(JSONB)
    content: Mapped[dict[str, str]] = mapped_column(JSONB)
    emoji: Mapped[str | None] = mapped_column(String(32))
    media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"))
    # Extra buttons: [{"label": {"en": ".."}, "emoji": "", "action": "url", "value": "https://.."}]
    buttons: Mapped[list[Any]] = mapped_column(JSONB, default=list, server_default="[]")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class FaqItem(Base, TimestampMixin):
    __tablename__ = "faq_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    question: Mapped[dict[str, str]] = mapped_column(JSONB)
    answer: Mapped[dict[str, str]] = mapped_column(JSONB)
    emoji: Mapped[str | None] = mapped_column(String(32))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


# ─── Support ────────────────────────────────────────────────────────────────


class Ticket(Base, TimestampMixin):
    __tablename__ = "tickets"
    __table_args__ = (Index("ix_tickets_status_updated", "status", "updated_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    number: Mapped[str] = mapped_column(String(24), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    subject: Mapped[str] = mapped_column(String(200))
    status: Mapped[TicketStatus] = mapped_column(enum_col(TicketStatus), default=TicketStatus.OPEN)
    priority: Mapped[TicketPriority] = mapped_column(enum_col(TicketPriority), default=TicketPriority.NORMAL)
    order_id: Mapped[int | None] = mapped_column(ForeignKey("orders.id", ondelete="SET NULL"))
    assigned_admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"), index=True)
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    unread_by_admin: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(lazy="joined")
    messages: Mapped[list[TicketMessage]] = relationship(
        back_populates="ticket", lazy="raise", order_by="TicketMessage.created_at"
    )


class TicketMessage(Base):
    __tablename__ = "ticket_messages"
    __table_args__ = (Index("ix_ticket_messages_ticket_created", "ticket_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    ticket_id: Mapped[int] = mapped_column(ForeignKey("tickets.id", ondelete="CASCADE"))
    sender: Mapped[str] = mapped_column(String(16))  # customer | admin | system
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text, default="")
    # [{"type": "photo", "file_id": "...", "media_id": "..."}]
    attachments: Mapped[list[Any]] = mapped_column(JSONB, default=list, server_default="[]")
    delivered: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    ticket: Mapped[Ticket] = relationship(back_populates="messages")


# ─── Broadcasts ─────────────────────────────────────────────────────────────


class Broadcast(Base, TimestampMixin):
    __tablename__ = "broadcasts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[BroadcastStatus] = mapped_column(enum_col(BroadcastStatus), default=BroadcastStatus.DRAFT)
    # Per-language text; recipients get their language or the default.
    text: Mapped[dict[str, str]] = mapped_column(JSONB)
    media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("media.id", ondelete="SET NULL"))
    buttons: Mapped[list[Any]] = mapped_column(JSONB, default=list, server_default="[]")
    audience: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    disable_notification: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    protect_content: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    total_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    sent_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    failed_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    blocked_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_by: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))


class BroadcastRecipient(Base):
    __tablename__ = "broadcast_recipients"
    __table_args__ = (
        UniqueConstraint("broadcast_id", "user_id"),
        Index("ix_broadcast_recipients_status", "broadcast_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    broadcast_id: Mapped[int] = mapped_column(ForeignKey("broadcasts.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    status: Mapped[RecipientStatus] = mapped_column(enum_col(RecipientStatus), default=RecipientStatus.PENDING)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    error: Mapped[str | None] = mapped_column(String(255))
    message_id: Mapped[int | None] = mapped_column()
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


# ─── Notifications (in-dashboard notification center) ─────────────────────


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    type: Mapped[str] = mapped_column(String(48), index=True)
    severity: Mapped[str] = mapped_column(String(16), default="info")  # info|success|warning|critical
    title: Mapped[str] = mapped_column(String(200))
    body: Mapped[str | None] = mapped_column(String(1000))
    link: Mapped[str | None] = mapped_column(String(255))
    data: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    permission: Mapped[str | None] = mapped_column(String(64))  # only admins with this permission see it
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class NotificationRead(Base):
    __tablename__ = "notification_reads"

    notification_id: Mapped[int] = mapped_column(
        ForeignKey("notifications.id", ondelete="CASCADE"), primary_key=True
    )
    admin_id: Mapped[int] = mapped_column(ForeignKey("admins.id", ondelete="CASCADE"), primary_key=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# ─── Audit log ──────────────────────────────────────────────────────────────


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_entity", "entity_type", "entity_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_id: Mapped[int | None] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"), index=True)
    admin_email: Mapped[str | None] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(48))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(String(500))
    old_value: Mapped[Any | None] = mapped_column(JSONB)
    new_value: Mapped[Any | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


# ─── Webhooks (incoming idempotency + outgoing integrations) ────────────────


class WebhookEvent(Base):
    """Every incoming provider webhook, deduplicated by (provider, event_id)."""

    __tablename__ = "webhooks"
    __table_args__ = (UniqueConstraint("provider", "event_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    provider: Mapped[str] = mapped_column(String(32))
    event_id: Mapped[str] = mapped_column(String(128))
    event_type: Mapped[str | None] = mapped_column(String(64))
    signature_valid: Mapped[bool] = mapped_column(Boolean, default=False)
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default="received")  # received|processed|ignored|failed
    error: Mapped[str | None] = mapped_column(String(500))
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class WebhookEndpoint(Base, TimestampMixin):
    """Outgoing webhooks to external systems (integrations)."""

    __tablename__ = "webhook_endpoints"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    url: Mapped[str] = mapped_column(String(500))
    secret_enc: Mapped[str] = mapped_column(Text)
    events: Mapped[list[str]] = mapped_column(ARRAY(String(48)), default=list, server_default="{}")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    last_status: Mapped[int | None] = mapped_column(Integer)
    last_delivery_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WebhookDelivery(Base):
    __tablename__ = "webhook_deliveries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    endpoint_id: Mapped[int] = mapped_column(ForeignKey("webhook_endpoints.id", ondelete="CASCADE"), index=True)
    event: Mapped[str] = mapped_column(String(48))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|success|failed
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    response_code: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
