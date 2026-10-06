"""Model → JSON-ready dict converters shared by routers."""

from __future__ import annotations

from typing import Any

from app.core.utils import i18n_get
from app.models import (
    Category,
    InventoryItem,
    Media,
    Order,
    OrderItem,
    Payment,
    PaymentMethod,
    Product,
    ProductVariant,
    PromoCode,
    Ticket,
    User,
)


def media_out(m: Media | None) -> dict[str, Any] | None:
    if m is None:
        return None
    return {
        "id": str(m.id), "title": m.title, "original_name": m.original_name, "folder": m.folder, "mime_type": m.mime_type,
        "kind": m.kind, "size": m.size, "width": m.width, "height": m.height, "duration": m.duration,
        "url": f"/api/media/{m.id}/file?v={m.version}", "created_at": m.created_at, "updated_at": m.updated_at,
        "version": m.version,
    }


def category_out(c: Category, product_count: int | None = None) -> dict[str, Any]:
    return {
        "id": c.id, "parent_id": c.parent_id, "slug": c.slug, "name": c.name, "description": c.description or {},
        "emoji": c.emoji, "custom_emoji_id": c.custom_emoji_id, "media_id": str(c.media_id) if c.media_id else None,
        "sort_order": c.sort_order, "is_visible": c.is_visible, "product_count": product_count,
        "created_at": c.created_at, "updated_at": c.updated_at,
    }


def variant_out(v: ProductVariant, stock: int | None = None) -> dict[str, Any]:
    return {
        "id": v.id, "sku": v.sku, "name": v.name, "attributes": v.attributes or {}, "price": v.price,
        "old_price": v.old_price, "cost_price": v.cost_price, "manual_stock": v.manual_stock,
        "delivery_mode": v.delivery_mode.value if v.delivery_mode else None,
        "fulfillment_config": _public_fulfillment(v.fulfillment_config or {}),
        "instructions": v.instructions or {}, "sort_order": v.sort_order, "is_active": v.is_active,
        "is_default": v.is_default, "stock": stock,
    }


def _public_fulfillment(cfg: dict[str, Any]) -> dict[str, Any]:
    out = {k: v for k, v in cfg.items() if not k.endswith("_enc")}
    for k in cfg:
        if k.endswith("_enc"):
            out[k[:-4] + "_set"] = True
    return out


def product_out(p: Product, stocks: dict[int, int | None] | None = None, *, full: bool = True) -> dict[str, Any]:
    stocks = stocks or {}
    variants = [variant_out(v, stocks.get(v.id)) for v in p.variants]
    active = [v for v in p.variants if v.is_active]
    prices = [v.price for v in active] or [0]
    stock_values = [stocks.get(v.id) for v in active]
    stock = None if any(s is None for s in stock_values) and stocks else sum(s or 0 for s in stock_values)
    data = {
        "id": p.id, "slug": p.slug, "name": p.name, "display_name": i18n_get(p.name, "en"), "emoji": p.emoji,
        "custom_emoji_id": p.custom_emoji_id, "category_id": p.category_id,
        "category": {"id": p.category.id, "name": p.category.name, "emoji": p.category.emoji} if p.category else None,
        "media_id": str(p.media_id) if p.media_id else None, "status": p.status.value, "sort_order": p.sort_order,
        "is_featured": p.is_featured, "price_min": min(prices), "price_max": max(prices), "stock": stock,
        "stock_mode": p.stock_mode.value, "delivery_mode": p.delivery_mode.value, "sold_count": p.sold_count,
        "views_count": p.views_count, "rating_avg": p.rating_avg, "rating_count": p.rating_count,
        "variants_count": len(p.variants), "tags": p.tags or [], "created_at": p.created_at, "updated_at": p.updated_at,
    }
    if full:
        data.update({
            "short_description": p.short_description or {}, "description": p.description or {},
            "currency": p.currency, "warranty": p.warranty or {}, "delivery_instructions": p.delivery_instructions or {},
            "fulfillment_config": _public_fulfillment(p.fulfillment_config or {}), "min_quantity": p.min_quantity,
            "max_quantity": p.max_quantity, "max_per_customer": p.max_per_customer, "regions": p.regions or [],
            "languages": p.languages or [], "option_groups": p.option_groups or [], "variants": variants,
            "low_stock_threshold": p.low_stock_threshold, "seo": p.seo or {},
        })
    else:
        data["variants"] = variants
    return data


def user_brief(u: User) -> dict[str, Any]:
    return {"id": u.id, "telegram_id": u.telegram_id, "username": u.username, "first_name": u.first_name,
            "last_name": u.last_name, "display_name": u.display_name, "language": u.language, "is_banned": u.is_banned}


def user_out(u: User) -> dict[str, Any]:
    return {
        **user_brief(u), "language_code": u.language_code, "is_premium": u.is_premium, "ban_reason": u.ban_reason,
        "bot_blocked": u.bot_blocked, "balance": u.balance, "referral_code": u.referral_code,
        "referred_by_id": u.referred_by_id, "total_spent": u.total_spent, "orders_count": u.orders_count,
        "paid_orders_count": u.paid_orders_count, "last_activity_at": u.last_activity_at, "first_order_at": u.first_order_at,
        "created_at": u.created_at, "tags": [{"id": t.id, "name": t.name, "color": t.color} for t in u.tags],
        "start_param": u.start_param,
    }


def order_item_out(i: OrderItem) -> dict[str, Any]:
    return {
        "id": i.id, "product_id": i.product_id, "variant_id": i.variant_id, "product_name": i.product_name,
        "variant_name": i.variant_name, "sku": i.sku, "unit_price": i.unit_price, "unit_cost": i.unit_cost,
        "quantity": i.quantity, "discount": i.discount, "total": i.total, "delivery_mode": i.delivery_mode.value,
        "delivered_quantity": i.delivered_quantity, "delivered_at": i.delivered_at,
    }


def payment_out(p: Payment) -> dict[str, Any]:
    extra = p.extra or {}
    return {
        "id": str(p.id), "reference": p.reference, "order_id": p.order_id, "method_code": p.method_code,
        "provider": p.provider, "status": p.status.value, "amount": p.amount, "currency": p.currency,
        "pay_amount": p.pay_amount, "pay_currency": p.pay_currency, "network": p.network, "address": p.address,
        "memo": p.memo, "pay_url": p.pay_url, "external_id": p.external_id, "tx_hash": p.tx_hash,
        "confirmations": p.confirmations, "confirmations_required": extra.get("confirmations_required"),
        "received_amount": p.received_amount, "refunded_amount": p.refunded_amount, "expires_at": p.expires_at,
        "paid_at": p.paid_at, "last_checked_at": p.last_checked_at, "error": p.error, "created_at": p.created_at,
        "kind": extra.get("kind"),
    }


def order_brief(o: Order) -> dict[str, Any]:
    first = o.items[0] if o.items else None
    return {
        "id": o.id, "number": o.number, "status": o.status.value, "delivery_status": o.delivery_status.value,
        "customer": user_brief(o.user), "product": first.product_name if first else None,
        "variant": first.variant_name if first else None, "items_count": len(o.items),
        "quantity": sum(i.quantity for i in o.items), "total": o.total + o.balance_used, "amount_due": o.total,
        "currency": o.currency, "payment_method": o.payment_method, "created_at": o.created_at, "paid_at": o.paid_at,
        "source": o.source,
    }


def order_out(o: Order) -> dict[str, Any]:
    return {
        **order_brief(o), "subtotal": o.subtotal, "discount_total": o.discount_total, "balance_used": o.balance_used,
        "cost_total": o.cost_total, "refunded_amount": o.refunded_amount, "promo_code": o.promo_code,
        "language": o.language, "admin_notes": o.admin_notes, "customer_note": o.customer_note,
        "expires_at": o.expires_at, "delivered_at": o.delivered_at, "completed_at": o.completed_at,
        "cancelled_at": o.cancelled_at, "items": [order_item_out(i) for i in o.items],
        "payments": [payment_out(p) for p in o.payments], "customer_full": user_out(o.user),
    }


def inventory_out(i: InventoryItem) -> dict[str, Any]:
    return {
        "id": i.id, "product_id": i.product_id, "variant_id": i.variant_id, "kind": i.kind.value, "preview": i.preview,
        "status": i.status.value, "order_id": i.order_id, "reserved_at": i.reserved_at, "delivered_at": i.delivered_at,
        "batch": i.batch, "note": i.note, "created_at": i.created_at,
        "variant_name": i.variant.name if i.variant else None, "sku": i.variant.sku if i.variant else None,
    }


def promo_out(p: PromoCode) -> dict[str, Any]:
    return {
        "id": p.id, "code": p.code, "description": p.description, "type": p.type.value, "value": p.value,
        "max_discount": p.max_discount, "min_purchase": p.min_purchase, "max_uses": p.max_uses,
        "max_uses_per_user": p.max_uses_per_user, "starts_at": p.starts_at, "expires_at": p.expires_at,
        "product_ids": p.product_ids or [], "category_ids": p.category_ids or [], "user_ids": p.user_ids or [],
        "new_customers_only": p.new_customers_only, "enabled": p.enabled, "uses_count": p.uses_count,
        "created_at": p.created_at,
    }


def payment_method_out(m: PaymentMethod, secret_keys: list[str] | None = None, secrets: dict[str, Any] | None = None) -> dict[str, Any]:
    from app.core.utils import mask_secret

    secrets = secrets or {}
    return {
        "id": m.id, "code": m.code, "provider": m.provider, "name": m.name, "description": m.description or {},
        "emoji": m.emoji, "custom_emoji_id": m.custom_emoji_id, "enabled": m.enabled, "sort_order": m.sort_order,
        "public_config": m.public_config or {}, "min_amount": m.min_amount, "max_amount": m.max_amount,
        "fee_percent": m.fee_percent,
        "secrets": {k: {"set": bool(secrets.get(k)), "masked": mask_secret(str(secrets.get(k) or ""))}
                    for k in (secret_keys or [])},
        "last_health_ok": m.last_health_ok, "last_health_at": m.last_health_at, "last_health_error": m.last_health_error,
    }


def ticket_out(t: Ticket) -> dict[str, Any]:
    return {
        "id": t.id, "number": t.number, "subject": t.subject, "status": t.status.value, "priority": t.priority.value,
        "order_id": t.order_id, "assigned_admin_id": t.assigned_admin_id, "last_message_at": t.last_message_at,
        "unread": t.unread_by_admin, "created_at": t.created_at, "updated_at": t.updated_at, "customer": user_brief(t.user),
    }
