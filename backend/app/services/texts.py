"""Bot texts & translations: defaults from code, overrides from the database."""

from __future__ import annotations

import re
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import SessionLocal, on_commit
from app.core.redis import redis
from app.localization.defaults import TEXTS, TEXTS_BY_KEY
from app.models import Language, Translation
from app.security.html import escape, sanitize_telegram_html, strip_custom_emoji
from app.services.settings import settings_store

_VERSION_KEY = "cfg:texts:version"
_PLACEHOLDER = re.compile(r"\{([a-z_][a-z0-9_]*)\}")


class SafeHtml(str):
    """Marks a value that is already valid Telegram HTML and must not be escaped."""


def render_template(template: str, variables: dict[str, Any]) -> str:
    """Substitute {placeholders}. Plain values are HTML-escaped, SafeHtml values are inserted as-is.

    Unknown placeholders are left untouched so admins see what's missing in previews.
    """

    def repl(m: re.Match[str]) -> str:
        name = m.group(1)
        if name not in variables:
            return m.group(0)
        value = variables[name]
        if value is None:
            return ""
        return str(value) if isinstance(value, SafeHtml) else escape(value)

    return _PLACEHOLDER.sub(repl, template)


def cleanup_whitespace(text: str) -> str:
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


class TextStore:
    def __init__(self) -> None:
        self._overrides: dict[tuple[str, str], str] | None = None
        self._languages: list[dict[str, Any]] = []
        self._version: str | None = None
        self._checked_at = 0.0

    async def _ensure(self) -> None:
        now = time.monotonic()
        if self._overrides is not None and now - self._checked_at < 1.0:
            return
        self._checked_at = now
        try:
            version = str(await redis.get(_VERSION_KEY) or "0")
        except Exception:
            version = self._version or "0"
        if self._overrides is not None and version == self._version:
            return
        async with SessionLocal() as s:
            rows = (await s.execute(select(Translation.key, Translation.lang, Translation.value))).all()
            langs = (await s.execute(select(Language).order_by(Language.sort_order))).scalars().all()
        self._overrides = {(r.key, r.lang): r.value for r in rows}
        self._languages = [
            {"code": lang.code, "name": lang.name, "native_name": lang.native_name, "flag": lang.flag,
             "enabled": lang.enabled}
            for lang in langs
        ]
        self._version = version

    async def languages(self, enabled_only: bool = True) -> list[dict[str, Any]]:
        await self._ensure()
        return [lang for lang in self._languages if lang["enabled"] or not enabled_only]

    async def raw(self, key: str, lang: str) -> str:
        await self._ensure()
        assert self._overrides is not None
        loc = await settings_store.group("localization")
        fallback = loc.get("fallback_language", "en")
        for candidate in (lang, fallback, "en"):
            if (key, candidate) in self._overrides:
                return self._overrides[(key, candidate)]
            d = TEXTS_BY_KEY.get(key)
            if d is not None:
                value = d.get(candidate)
                if value is not None:
                    return value
        return key

    async def get(self, key: str, lang: str, **variables: Any) -> str:
        template = await self.raw(key, lang)
        text = render_template(template, variables)
        if not await settings_store.get("bot.custom_emoji_in_messages", False):
            text = strip_custom_emoji(text)
        return text

    async def invalidate(self) -> None:
        self._overrides = None
        try:
            await redis.incr(_VERSION_KEY)
        except Exception:
            pass

    async def catalog(self, session: AsyncSession) -> list[dict[str, Any]]:
        """Full text catalog for the Bot Editor: defaults + overrides for every language."""
        rows = (await session.execute(select(Translation))).scalars().all()
        overrides: dict[str, dict[str, str]] = {}
        for r in rows:
            overrides.setdefault(r.key, {})[r.lang] = r.value
        langs = [lang.code for lang in (await session.execute(select(Language))).scalars().all()]
        out = []
        for t in TEXTS:
            values = {}
            for code in langs:
                values[code] = overrides.get(t.key, {}).get(code, t.get(code) or "")
            out.append(
                {
                    "key": t.key,
                    "section": t.section,
                    "description": t.description,
                    "variables": list(t.variables),
                    "values": values,
                    "defaults": {code: t.get(code) or "" for code in langs},
                    "overridden": sorted(overrides.get(t.key, {}).keys()),
                }
            )
        return out

    async def save(
        self, session: AsyncSession, key: str, values: dict[str, str | None], admin_id: int | None = None
    ) -> None:
        if key not in TEXTS_BY_KEY:
            raise KeyError(key)
        default = TEXTS_BY_KEY[key]
        for lang, value in values.items():
            existing = (
                await session.execute(select(Translation).where(Translation.key == key, Translation.lang == lang))
            ).scalar_one_or_none()
            if value is None or value == (default.get(lang) or None):
                # reset to default
                if existing is not None:
                    await session.delete(existing)
                continue
            clean = sanitize_telegram_html(value) if not key.startswith("btn.") else value.strip()
            if existing is None:
                session.add(Translation(key=key, lang=lang, value=clean, updated_by=admin_id))
            else:
                existing.value = clean
                existing.updated_by = admin_id
        await session.flush()
        on_commit(session, self.invalidate)


text_store = TextStore()


async def t(key: str, lang: str, **variables: Any) -> str:
    return await text_store.get(key, lang, **variables)


async def btn(key: str, lang: str, **variables: Any) -> str:
    """Button labels are plain text (Telegram does not render HTML in buttons)."""
    raw = await text_store.raw(key, lang)
    return _PLACEHOLDER.sub(lambda m: str(variables.get(m.group(1), m.group(0))), raw)
