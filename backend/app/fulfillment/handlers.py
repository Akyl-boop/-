"""Fulfillment strategies, one per delivery mode."""

from __future__ import annotations

import hashlib
import hmac
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, ClassVar

import httpx
import orjson
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import decrypt_str
from app.core.logging import get_logger
from app.core.utils import i18n_get
from app.models import Order, OrderItem, Product, ProductVariant
from app.models.enums import DeliveryMode, StockMode
from app.services import inventory as inv

log = get_logger(__name__)


@dataclass
class DeliveredUnit:
    type: str  # text | file
    value: str = ""
    media_id: str | None = None
    name: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, "value": self.value, "media_id": self.media_id, "name": self.name}


@dataclass
class FulfillResult:
    units: list[DeliveredUnit] = field(default_factory=list)
    quantity: int = 0  # how many units of the order item are now satisfied
    waiting: bool = False  # waiting for manual/external action
    error: str | None = None


@dataclass
class FulfillContext:
    session: AsyncSession
    order: Order
    item: OrderItem
    product: Product | None
    variant: ProductVariant | None
    config: dict[str, Any]
    lang: str
    remaining: int


class Fulfiller(ABC):
    mode: ClassVar[DeliveryMode]

    @abstractmethod
    async def fulfill(self, ctx: FulfillContext) -> FulfillResult: ...


class InventoryFulfiller(Fulfiller):
    mode = DeliveryMode.INVENTORY

    async def fulfill(self, ctx: FulfillContext) -> FulfillResult:
        items = await inv.take_reserved(ctx.session, ctx.item.id, ctx.remaining)
        missing = ctx.remaining - len(items)
        if missing > 0 and ctx.variant is not None and ctx.product is not None \
                and ctx.product.stock_mode == StockMode.INVENTORY:
            # Reservation may have been released (late payment) — try to reserve fresh stock.
            try:
                await inv.reserve(ctx.session, ctx.variant.id, missing, ctx.order.id, ctx.item.id)
            except Exception:
                pass
            items = await inv.take_reserved(ctx.session, ctx.item.id, ctx.remaining)
        units = []
        for it in items:
            if it.kind.value == "file" and it.media_id:
                units.append(DeliveredUnit(type="file", media_id=str(it.media_id), name=it.note))
            else:
                units.append(DeliveredUnit(type="text", value=inv.reveal(it)))
        await inv.mark_delivered(ctx.session, items, ctx.order.id)
        result = FulfillResult(units=units, quantity=len(items))
        if len(items) < ctx.remaining:
            result.error = f"Insufficient inventory: delivered {len(items)} of {ctx.remaining}"
        return result


class TextFulfiller(Fulfiller):
    mode = DeliveryMode.TEXT

    async def fulfill(self, ctx: FulfillContext) -> FulfillResult:
        raw = ctx.config.get("text")
        text = i18n_get(raw, ctx.lang) if isinstance(raw, dict) else (raw or "")
        if ctx.config.get("text_enc"):
            text = decrypt_str(ctx.config["text_enc"]) or text
        if not text:
            return FulfillResult(error="Static delivery text is not configured")
        return FulfillResult(units=[DeliveredUnit(type="text", value=text)], quantity=ctx.remaining)


class FileFulfiller(Fulfiller):
    mode = DeliveryMode.FILE

    async def fulfill(self, ctx: FulfillContext) -> FulfillResult:
        media_id = ctx.config.get("media_id")
        if not media_id:
            return FulfillResult(error="Delivery file is not configured")
        return FulfillResult(units=[DeliveredUnit(type="file", media_id=str(media_id))], quantity=ctx.remaining)


class ManualFulfiller(Fulfiller):
    mode = DeliveryMode.MANUAL

    async def fulfill(self, ctx: FulfillContext) -> FulfillResult:
        return FulfillResult(waiting=True)


def _sign(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def _payload(ctx: FulfillContext) -> dict[str, Any]:
    return {
        "order": ctx.order.number, "order_id": ctx.order.id, "order_item_id": ctx.item.id,
        "sku": ctx.item.sku, "product": ctx.item.product_name, "variant": ctx.item.variant_name,
        "quantity": ctx.remaining, "customer_telegram_id": ctx.order.user.telegram_id if ctx.order.user else None,
        "callback_url": f"{settings.webhook_base}/api/integrations/fulfillment/{ctx.item.id}",
    }


class ApiFulfiller(Fulfiller):
    """POST to an external API that synchronously returns the goods: {"items": ["code", ...]}."""

    mode = DeliveryMode.API

    async def fulfill(self, ctx: FulfillContext) -> FulfillResult:
        url = ctx.config.get("url")
        if not url:
            return FulfillResult(error="API URL is not configured")
        secret = decrypt_str(ctx.config.get("secret_enc")) if ctx.config.get("secret_enc") else ""
        body = orjson.dumps(_payload(ctx))
        headers = {"Content-Type": "application/json", "X-Nexa-Signature": _sign(body, secret or "")}
        if token := (decrypt_str(ctx.config.get("auth_enc")) if ctx.config.get("auth_enc") else None):
            headers["Authorization"] = token
        try:
            async with httpx.AsyncClient(timeout=float(ctx.config.get("timeout") or 20)) as client:
                r = await client.post(url, content=body, headers=headers)
            r.raise_for_status()
            data = r.json()
        except Exception as exc:
            log.warning("api_fulfillment_failed", order=ctx.order.number, error=str(exc))
            return FulfillResult(error=f"API fulfillment failed: {exc}"[:300])
        items = data.get("items") if isinstance(data, dict) else None
        if not isinstance(items, list) or not items:
            return FulfillResult(error="API returned no items")
        units = [DeliveredUnit(type="text", value=str(v)[:4000]) for v in items[: ctx.remaining]]
        return FulfillResult(units=units, quantity=min(len(items), ctx.remaining))


class WebhookFulfiller(Fulfiller):
    """Notify an external system; it delivers later by calling our signed callback endpoint."""

    mode = DeliveryMode.WEBHOOK

    async def fulfill(self, ctx: FulfillContext) -> FulfillResult:
        url = ctx.config.get("url")
        if not url:
            return FulfillResult(error="Webhook URL is not configured")
        secret = decrypt_str(ctx.config.get("secret_enc")) if ctx.config.get("secret_enc") else ""
        body = orjson.dumps(_payload(ctx))
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.post(url, content=body, headers={"Content-Type": "application/json",
                                                                  "X-Nexa-Signature": _sign(body, secret or "")})
            r.raise_for_status()
        except Exception as exc:
            return FulfillResult(error=f"Webhook notification failed: {exc}"[:300])
        return FulfillResult(waiting=True)


FULFILLERS: dict[DeliveryMode, Fulfiller] = {
    f.mode: f
    for f in (InventoryFulfiller(), TextFulfiller(), FileFulfiller(), ManualFulfiller(), ApiFulfiller(), WebhookFulfiller())
}
