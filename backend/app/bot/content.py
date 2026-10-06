"""Cached database-driven content for the bot: banners, menus, pages, FAQ."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select

from app.core.cache import content_cache
from app.core.database import SessionLocal
from app.models import Banner, FaqItem, Media, MenuButton, Page


async def _load_banners() -> dict[tuple[str, str | None], uuid.UUID]:
    async with SessionLocal() as s:
        rows = (await s.execute(select(Banner).where(Banner.enabled.is_(True)))).scalars().all()
        return {(b.placement, b.language): b.media_id for b in rows}


async def banner_media_id(placement: str, lang: str) -> uuid.UUID | None:
    banners = await content_cache.get("banners", _load_banners)
    return banners.get((placement, lang)) or banners.get((placement, None))


async def get_media(media_id: uuid.UUID | None) -> Media | None:
    if media_id is None:
        return None

    async def _load() -> Media | None:
        async with SessionLocal() as s:
            m = await s.get(Media, media_id)
            return m if m is not None and m.deleted_at is None else None

    # Not cached across file replacements: key includes id only, cache invalidated on media change.
    return await content_cache.get(f"media:{media_id}", _load)


async def banner(placement: str, lang: str) -> Media | None:
    return await get_media(await banner_media_id(placement, lang))


async def menu_buttons(menu: str = "main") -> list[dict[str, Any]]:
    async def _load() -> list[dict[str, Any]]:
        async with SessionLocal() as s:
            rows = (
                await s.execute(
                    select(MenuButton).where(MenuButton.menu == menu, MenuButton.visible.is_(True))
                    .order_by(MenuButton.row, MenuButton.position, MenuButton.id)
                )
            ).scalars().all()
            return [
                {"id": b.id, "label": b.label, "emoji": b.emoji, "custom_emoji_id": b.custom_emoji_id,
                 "style": b.style, "action": b.action, "value": b.action_value, "row": b.row,
                 "languages": list(b.languages or [])}
                for b in rows
            ]

    return await content_cache.get(f"menu:{menu}", _load)


async def menu_button(button_id: int) -> dict[str, Any] | None:
    for menu in ("main", "profile"):
        for b in await menu_buttons(menu):
            if b["id"] == button_id:
                return b
    async with SessionLocal() as s:
        b = await s.get(MenuButton, button_id)
        if b is None:
            return None
        return {"id": b.id, "label": b.label, "action": b.action, "value": b.action_value, "emoji": b.emoji}


async def pages() -> dict[str, dict[str, Any]]:
    async def _load() -> dict[str, dict[str, Any]]:
        async with SessionLocal() as s:
            rows = (await s.execute(select(Page).where(Page.enabled.is_(True)).order_by(Page.sort_order))).scalars().all()
            return {
                p.slug: {"slug": p.slug, "title": p.title, "content": p.content, "emoji": p.emoji,
                         "media_id": p.media_id, "buttons": p.buttons or []}
                for p in rows
            }

    return await content_cache.get("pages", _load)


async def faq_items() -> list[dict[str, Any]]:
    async def _load() -> list[dict[str, Any]]:
        async with SessionLocal() as s:
            rows = (
                await s.execute(select(FaqItem).where(FaqItem.enabled.is_(True)).order_by(FaqItem.sort_order, FaqItem.id))
            ).scalars().all()
            return [{"id": f.id, "q": f.question, "a": f.answer, "emoji": f.emoji} for f in rows]

    return await content_cache.get("faq", _load)
