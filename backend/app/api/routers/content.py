"""Bot content: texts & translations, menu builder, pages, FAQ, banners, languages, live preview."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from app.api.deps import DB, Perm
from app.core.cache import content_cache
from app.core.database import on_commit
from app.core.errors import Conflict, NotFound, ValidationFailed
from app.core.utils import slugify
from app.localization.defaults import TEXTS_BY_KEY
from app.models import Banner, FaqItem, Language, MenuButton, Page, Translation, User
from app.security.html import sanitize_telegram_html
from app.services.audit import audit
from app.services.texts import render_template, text_store

router = APIRouter(tags=["content"])

PLACEMENTS = ["home", "categories", "products", "promotions", "checkout", "success", "profile", "support", "maintenance"]
MENU_ACTIONS = ["catalog", "cart", "orders", "profile", "support", "faq", "search", "favorites", "recent", "referrals",
                "language", "page", "terms", "category", "product", "url", "payment", "custom"]


def _invalidate(session: Any) -> None:
    on_commit(session, content_cache.invalidate)


# ─── Texts ──────────────────────────────────────────────────────────────────


@router.get("/content/texts")
async def texts(session: DB, auth: Perm("content.edit")) -> dict[str, Any]:
    catalog = await text_store.catalog(session)
    sections: dict[str, int] = {}
    for t in catalog:
        sections[t["section"]] = sections.get(t["section"], 0) + 1
    return {"items": catalog, "sections": [{"name": k, "count": v} for k, v in sections.items()]}


class TextIn(BaseModel):
    values: dict[str, str | None]


@router.put("/content/texts/{key}")
async def save_text(key: str, body: TextIn, session: DB, auth: Perm("content.edit")) -> dict[str, str]:
    if key not in TEXTS_BY_KEY:
        raise NotFound("Unknown text key")
    langs = {lang.code for lang in (await session.execute(select(Language))).scalars()}
    values = {k: v for k, v in body.values.items() if k in langs}
    old = {r.lang: r.value for r in (await session.execute(select(Translation).where(Translation.key == key))).scalars()}
    await text_store.save(session, key, values, admin_id=auth.admin.id)
    await audit(session, auth.admin, "content.text", f"Edited bot text “{key}”", entity_type="text", entity_id=key,
                old=old, new=values)
    return {"status": "ok"}


@router.post("/content/texts/{key}/reset")
async def reset_text(key: str, session: DB, auth: Perm("content.edit")) -> dict[str, str]:
    await session.execute(delete(Translation).where(Translation.key == key))
    on_commit(session, text_store.invalidate)
    await audit(session, auth.admin, "content.text_reset", f"Reset bot text “{key}” to default", entity_type="text", entity_id=key)
    return {"status": "ok"}


class PreviewIn(BaseModel):
    text: str = Field(max_length=8000)
    variables: dict[str, Any] = Field(default_factory=dict)


SAMPLE_VARS = {
    "store_name": "Nexa Store", "first_name": "Alex", "balance": "$12.50", "orders_count": 3, "count": 3, "total": "$59",
    "price": "$19.90", "old_price": "$24", "percent": 17, "order": "NX-10042", "amount": "$19.90", "method": "USDT · TRC20",
    "expires": "29 min", "network": "TRON (TRC20)", "currency": "USDT", "address": "TQ5n…sample…9Xy", "confirmations": 1,
    "name": "ChatGPT Plus", "product": "ChatGPT Plus", "variant": " · 1 month", "qty": 1, "date": "2026-10-06 12:00 UTC",
    "delivery": "<code>XXXX-YYYY-ZZZZ</code>", "ticket": "T-1042", "subject": "Activation help", "query": "chatgpt",
    "code": "WELCOME10", "reward": "5%", "link": "https://t.me/your_bot?start=ref_ABCD1234", "invited": 4, "converted": 2,
    "earned": "$7.40", "telegram_id": 123456789, "joined": "2026-05-01", "spent": "$128", "rating": "4.8",
}


@router.post("/content/preview")
async def preview(body: PreviewIn, auth: Perm("content.edit")) -> dict[str, str]:
    """Render a template exactly like the bot does (sanitizer + placeholders) for the live preview."""
    from app.services.texts import SafeHtml

    variables: dict[str, Any] = {**SAMPLE_VARS, **body.variables}
    for k in ("delivery", "price_block", "stock", "description", "warranty", "rating", "summary", "items", "memo",
              "instructions", "messages", "channels", "balance", "payment", "first_only", "to_balance", "reviews"):
        if k in variables and isinstance(variables[k], str):
            variables[k] = SafeHtml(sanitize_telegram_html(variables[k]))
    html = render_template(sanitize_telegram_html(body.text), variables)
    return {"html": html}


# ─── Languages ──────────────────────────────────────────────────────────────


class LanguageIn(BaseModel):
    code: str = Field(min_length=2, max_length=8, pattern=r"^[a-z]{2,3}(-[a-z]{2})?$")
    name: str = Field(min_length=1, max_length=64)
    native_name: str = Field(min_length=1, max_length=64)
    flag: str = Field("🏳️", max_length=16)
    enabled: bool = True
    sort_order: int = 0


@router.get("/languages")
async def list_languages(session: DB, auth: Perm("dashboard.view")) -> list[dict[str, Any]]:
    langs = (await session.execute(select(Language).order_by(Language.sort_order))).scalars().all()
    users = dict((await session.execute(select(User.language, func.count()).group_by(User.language))).all())
    overrides: dict[str, set[str]] = {}
    for key, lang_code in (await session.execute(select(Translation.key, Translation.lang))).all():
        overrides.setdefault(lang_code, set()).add(key)
    total = len(TEXTS_BY_KEY)
    out = []
    for lang in langs:
        covered = {k for k, t in TEXTS_BY_KEY.items() if t.get(lang.code) is not None} | overrides.get(lang.code, set())
        out.append({"code": lang.code, "name": lang.name, "native_name": lang.native_name, "flag": lang.flag,
                    "enabled": lang.enabled, "sort_order": lang.sort_order, "customers": users.get(lang.code, 0),
                    "translated": len(covered), "total": total, "coverage": round(len(covered) / total * 100)})
    return out


@router.post("/languages", status_code=201)
async def create_language(body: LanguageIn, session: DB, auth: Perm("languages.manage")) -> dict[str, Any]:
    if await session.get(Language, body.code):
        raise Conflict("Language already exists")
    session.add(Language(**body.model_dump()))
    on_commit(session, text_store.invalidate)
    await audit(session, auth.admin, "language.create", f"Added language {body.name}", entity_type="language", entity_id=body.code)
    return body.model_dump()


@router.put("/languages/{code}")
async def update_language(code: str, body: LanguageIn, session: DB, auth: Perm("languages.manage")) -> dict[str, Any]:
    lang = await session.get(Language, code)
    if lang is None:
        raise NotFound("Language not found")
    from app.services.settings import settings_store

    if not body.enabled and (await settings_store.get("localization.default_language")) == code:
        raise ValidationFailed("You cannot disable the default language")
    lang.name, lang.native_name, lang.flag, lang.enabled, lang.sort_order = (
        body.name, body.native_name, body.flag, body.enabled, body.sort_order)
    on_commit(session, text_store.invalidate)
    await audit(session, auth.admin, "language.update", f"Updated language {code}", entity_type="language", entity_id=code)
    return body.model_dump()


@router.delete("/languages/{code}")
async def delete_language(code: str, session: DB, auth: Perm("languages.manage")) -> dict[str, str]:
    from app.services.settings import settings_store

    loc = await settings_store.group("localization")
    if code in (loc.get("default_language"), loc.get("fallback_language"), "en"):
        raise ValidationFailed("Default/fallback language cannot be deleted")
    lang = await session.get(Language, code)
    if lang:
        await session.delete(lang)
        await session.execute(delete(Translation).where(Translation.lang == code))
    on_commit(session, text_store.invalidate)
    await audit(session, auth.admin, "language.delete", f"Deleted language {code}", entity_type="language", entity_id=code)
    return {"status": "ok"}


# ─── Menus ──────────────────────────────────────────────────────────────────


class MenuButtonIn(BaseModel):
    id: int | None = None
    label: dict[str, str]
    emoji: str | None = Field(None, max_length=32)
    custom_emoji_id: str | None = Field(None, max_length=32, pattern=r"^\d*$")
    style: Literal["primary", "success", "danger"] | None = None
    action: str
    action_value: str | None = Field(None, max_length=4000)
    row: int = Field(ge=0, le=50)
    position: int = Field(ge=0, le=8)
    visible: bool = True
    languages: list[str] = Field(default_factory=list)


class MenuIn(BaseModel):
    buttons: list[MenuButtonIn] = Field(max_length=60)


@router.get("/menus/{menu}")
async def get_menu(menu: str, session: DB, auth: Perm("content.edit")) -> dict[str, Any]:
    rows = (await session.execute(select(MenuButton).where(MenuButton.menu == menu)
                                  .order_by(MenuButton.row, MenuButton.position, MenuButton.id))).scalars().all()
    return {"menu": menu, "actions": MENU_ACTIONS,
            "buttons": [{"id": b.id, "label": b.label, "emoji": b.emoji, "custom_emoji_id": b.custom_emoji_id,
                         "style": b.style, "action": b.action, "action_value": b.action_value, "row": b.row,
                         "position": b.position, "visible": b.visible, "languages": b.languages or []} for b in rows]}


@router.put("/menus/{menu}")
async def save_menu(menu: str, body: MenuIn, session: DB, auth: Perm("content.edit")) -> dict[str, Any]:
    if menu not in ("main", "profile"):
        raise ValidationFailed("Unknown menu")
    per_row: dict[int, int] = {}
    for b in body.buttons:
        if b.action not in MENU_ACTIONS:
            raise ValidationFailed(f"Unknown action {b.action}")
        if b.action in ("url",) and not (b.action_value or "").startswith(("https://", "http://", "tg://")):
            raise ValidationFailed("URL buttons need a valid http(s):// or tg:// link")
        if b.action in ("page", "category", "product") and not b.action_value:
            raise ValidationFailed(f"Button “{b.label.get('en', '')}” needs a target")
        if not any((v or "").strip() for v in b.label.values()):
            raise ValidationFailed("Every button needs a label")
        per_row[b.row] = per_row.get(b.row, 0) + 1
        if per_row[b.row] > 8:
            raise ValidationFailed("Telegram allows at most 8 buttons per row")
    existing = {b.id: b for b in (await session.execute(select(MenuButton).where(MenuButton.menu == menu))).scalars()}
    keep = set()
    for b in body.buttons:
        row = existing.get(b.id) if b.id else None
        if row is None:
            row = MenuButton(menu=menu)
            session.add(row)
        row.label = {k: v.strip()[:64] for k, v in b.label.items() if v}
        row.emoji, row.custom_emoji_id, row.style = b.emoji or None, b.custom_emoji_id or None, b.style
        row.action = b.action
        row.action_value = sanitize_telegram_html(b.action_value) if b.action == "custom" else b.action_value
        row.row, row.position, row.visible, row.languages = b.row, b.position, b.visible, b.languages
        if b.id:
            keep.add(b.id)
    for bid, row in existing.items():
        if bid not in keep:
            await session.delete(row)
    await audit(session, auth.admin, "content.menu", f"Saved {menu} menu layout ({len(body.buttons)} buttons)",
                entity_type="menu", entity_id=menu)
    _invalidate(session)
    await session.flush()
    return await get_menu(menu, session, auth)


# ─── Pages ──────────────────────────────────────────────────────────────────


class PageIn(BaseModel):
    slug: str | None = Field(None, max_length=64)
    title: dict[str, str]
    content: dict[str, str]
    emoji: str | None = Field(None, max_length=32)
    media_id: uuid.UUID | None = None
    buttons: list[dict[str, Any]] = Field(default_factory=list, max_length=20)
    enabled: bool = True
    sort_order: int = 0


def page_out(p: Page) -> dict[str, Any]:
    return {"id": p.id, "slug": p.slug, "title": p.title, "content": p.content, "emoji": p.emoji,
            "media_id": str(p.media_id) if p.media_id else None, "buttons": p.buttons or [], "enabled": p.enabled,
            "is_system": p.is_system, "sort_order": p.sort_order, "updated_at": p.updated_at}


@router.get("/pages")
async def list_pages(session: DB, auth: Perm("content.edit")) -> list[dict[str, Any]]:
    return [page_out(p) for p in (await session.execute(select(Page).order_by(Page.sort_order, Page.id))).scalars()]


def _apply_page(p: Page, body: PageIn) -> None:
    p.title = {k: v[:120] for k, v in body.title.items() if v}
    p.content = {k: sanitize_telegram_html(v) for k, v in body.content.items() if v}
    p.emoji, p.media_id, p.enabled, p.sort_order = body.emoji, body.media_id, body.enabled, body.sort_order
    p.buttons = [{"label": b.get("label") or {}, "emoji": b.get("emoji"), "action": b.get("action"),
                  "value": str(b.get("value") or "")[:500]} for b in body.buttons if b.get("action")]


@router.post("/pages", status_code=201)
async def create_page(body: PageIn, session: DB, auth: Perm("content.edit")) -> dict[str, Any]:
    slug = slugify(body.slug or body.title.get("en") or "page")[:40]
    if (await session.execute(select(Page).where(Page.slug == slug))).first():
        raise Conflict("A page with this slug already exists")
    p = Page(slug=slug, title={}, content={})
    _apply_page(p, body)
    session.add(p)
    await session.flush()
    await audit(session, auth.admin, "content.page_create", f"Created page {slug}", entity_type="page", entity_id=p.id)
    _invalidate(session)
    return page_out(p)


@router.put("/pages/{page_id}")
async def update_page(page_id: int, body: PageIn, session: DB, auth: Perm("content.edit")) -> dict[str, Any]:
    p = await session.get(Page, page_id)
    if p is None:
        raise NotFound("Page not found")
    _apply_page(p, body)
    if body.slug and not p.is_system and body.slug != p.slug:
        p.slug = slugify(body.slug)[:40]
    await audit(session, auth.admin, "content.page_update", f"Updated page {p.slug}", entity_type="page", entity_id=p.id)
    _invalidate(session)
    return page_out(p)


@router.delete("/pages/{page_id}")
async def delete_page(page_id: int, session: DB, auth: Perm("content.edit")) -> dict[str, str]:
    p = await session.get(Page, page_id)
    if p is None:
        raise NotFound("Page not found")
    if p.is_system:
        raise Conflict("System pages can be disabled but not deleted")
    await session.delete(p)
    await audit(session, auth.admin, "content.page_delete", f"Deleted page {p.slug}", entity_type="page", entity_id=page_id)
    _invalidate(session)
    return {"status": "ok"}


# ─── FAQ ────────────────────────────────────────────────────────────────────


class FaqIn(BaseModel):
    question: dict[str, str]
    answer: dict[str, str]
    emoji: str | None = Field(None, max_length=32)
    enabled: bool = True
    sort_order: int = 0


def faq_out(f: FaqItem) -> dict[str, Any]:
    return {"id": f.id, "question": f.question, "answer": f.answer, "emoji": f.emoji, "enabled": f.enabled,
            "sort_order": f.sort_order}


@router.get("/faq")
async def list_faq(session: DB, auth: Perm("content.edit")) -> list[dict[str, Any]]:
    return [faq_out(f) for f in (await session.execute(select(FaqItem).order_by(FaqItem.sort_order, FaqItem.id))).scalars()]


@router.post("/faq", status_code=201)
async def create_faq(body: FaqIn, session: DB, auth: Perm("content.edit")) -> dict[str, Any]:
    f = FaqItem(question={k: v[:200] for k, v in body.question.items() if v},
                answer={k: sanitize_telegram_html(v) for k, v in body.answer.items() if v},
                emoji=body.emoji, enabled=body.enabled, sort_order=body.sort_order)
    session.add(f)
    await session.flush()
    _invalidate(session)
    await audit(session, auth.admin, "content.faq_create", "Created FAQ item", entity_type="faq", entity_id=f.id)
    return faq_out(f)


@router.put("/faq/{faq_id}")
async def update_faq(faq_id: int, body: FaqIn, session: DB, auth: Perm("content.edit")) -> dict[str, Any]:
    f = await session.get(FaqItem, faq_id)
    if f is None:
        raise NotFound("FAQ item not found")
    f.question = {k: v[:200] for k, v in body.question.items() if v}
    f.answer = {k: sanitize_telegram_html(v) for k, v in body.answer.items() if v}
    f.emoji, f.enabled, f.sort_order = body.emoji, body.enabled, body.sort_order
    _invalidate(session)
    await audit(session, auth.admin, "content.faq_update", "Updated FAQ item", entity_type="faq", entity_id=f.id)
    return faq_out(f)


@router.delete("/faq/{faq_id}")
async def delete_faq(faq_id: int, session: DB, auth: Perm("content.edit")) -> dict[str, str]:
    f = await session.get(FaqItem, faq_id)
    if f:
        await session.delete(f)
    _invalidate(session)
    await audit(session, auth.admin, "content.faq_delete", "Deleted FAQ item", entity_type="faq", entity_id=faq_id)
    return {"status": "ok"}


class OrderIdsIn(BaseModel):
    ids: list[int]


@router.post("/faq/reorder")
async def reorder_faq(body: OrderIdsIn, session: DB, auth: Perm("content.edit")) -> dict[str, str]:
    items = {f.id: f for f in (await session.execute(select(FaqItem).where(FaqItem.id.in_(body.ids)))).scalars()}
    for i, fid in enumerate(body.ids):
        if fid in items:
            items[fid].sort_order = i
    _invalidate(session)
    return {"status": "ok"}


# ─── Banners ────────────────────────────────────────────────────────────────


@router.get("/banners")
async def list_banners(session: DB, auth: Perm("content.edit")) -> dict[str, Any]:
    from app.api.serializers import media_out

    rows = (await session.execute(select(Banner))).scalars().all()
    return {"placements": PLACEMENTS,
            "banners": [{"id": b.id, "placement": b.placement, "language": b.language, "enabled": b.enabled,
                         "media": media_out(b.media)} for b in rows]}


class BannerIn(BaseModel):
    placement: str
    language: str | None = None
    media_id: uuid.UUID
    enabled: bool = True


@router.put("/banners")
async def set_banner(body: BannerIn, session: DB, auth: Perm("content.edit")) -> dict[str, str]:
    if body.placement not in PLACEMENTS:
        raise ValidationFailed("Unknown placement")
    q = select(Banner).where(Banner.placement == body.placement)
    q = q.where(Banner.language.is_(None)) if body.language is None else q.where(Banner.language == body.language)
    b = (await session.execute(q)).scalar_one_or_none()
    if b is None:
        b = Banner(placement=body.placement, language=body.language, media_id=body.media_id)
        session.add(b)
    b.media_id, b.enabled = body.media_id, body.enabled
    _invalidate(session)
    await audit(session, auth.admin, "content.banner", f"Set {body.placement} banner ({body.language or 'all languages'})",
                entity_type="banner", entity_id=body.placement)
    return {"status": "ok"}


@router.delete("/banners/{banner_id}")
async def delete_banner(banner_id: int, session: DB, auth: Perm("content.edit")) -> dict[str, str]:
    b = await session.get(Banner, banner_id)
    if b:
        await session.delete(b)
    _invalidate(session)
    await audit(session, auth.admin, "content.banner_delete", "Removed banner", entity_type="banner", entity_id=banner_id)
    return {"status": "ok"}
