"""Per-update bot context: current user, language, settings and helpers."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from aiogram import Bot
from aiogram.types import CopyTextButton, InlineKeyboardButton, InlineKeyboardMarkup
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from app.services.money import format_amount
from app.services.texts import btn as text_btn
from app.services.texts import t as text_t

VALID_STYLES = {"primary", "success", "danger"}


@dataclass
class BotCtx:
    session: AsyncSession
    user: User
    lang: str
    cfg: dict[str, Any]
    bot: Bot
    extra: dict[str, Any] = field(default_factory=dict)

    async def t(self, key: str, **kw: Any) -> str:
        return await text_t(key, self.lang, **kw)

    async def b(self, key: str, **kw: Any) -> str:
        return await text_btn(key, self.lang, **kw)

    def feature(self, name: str) -> bool:
        return bool(self.cfg["features"].get(name))

    def money(self, amount: Decimal | float | int | None, currency: str | None = None) -> str:
        g = self.cfg["general"]
        cur = currency or g["currency"]
        sym = g.get("currency_symbol") if cur == g["currency"] else None
        return format_amount(amount, cur, sym, g.get("currency_position", "before"))

    def button(
        self,
        text: str,
        *,
        cb: Any = None,
        url: str | None = None,
        emoji: str | None = None,
        custom_emoji_id: str | None = None,
        style: str | None = None,
        copy_text: str | None = None,
        pay: bool = False,
    ) -> InlineKeyboardButton:
        bot_cfg = self.cfg["bot"]
        kwargs: dict[str, Any] = {}
        label = text
        if custom_emoji_id and bot_cfg.get("custom_emoji_on_buttons"):
            # Official Bot API: InlineKeyboardButton.icon_custom_emoji_id
            kwargs["icon_custom_emoji_id"] = custom_emoji_id
        elif emoji:
            label = f"{emoji} {text}".strip()
        if style in VALID_STYLES and bot_cfg.get("button_styles", True):
            kwargs["style"] = style
        if cb is not None:
            kwargs["callback_data"] = cb.pack() if hasattr(cb, "pack") else str(cb)
        elif url:
            kwargs["url"] = url
        elif copy_text is not None:
            kwargs["copy_text"] = CopyTextButton(text=copy_text[:256])
        elif pay:
            kwargs["pay"] = True
        return InlineKeyboardButton(text=label[:64] or "·", **kwargs)


class Kb:
    """Tiny keyboard builder."""

    def __init__(self) -> None:
        self.rows: list[list[InlineKeyboardButton]] = []

    def row(self, *buttons: InlineKeyboardButton | None) -> Kb:
        clean = [b for b in buttons if b is not None]
        if clean:
            self.rows.append(clean)
        return self

    def grid(self, buttons: list[InlineKeyboardButton], per_row: int) -> Kb:
        per_row = max(1, per_row)
        for i in range(0, len(buttons), per_row):
            self.rows.append(buttons[i : i + per_row])
        return self

    def markup(self) -> InlineKeyboardMarkup | None:
        return InlineKeyboardMarkup(inline_keyboard=self.rows) if self.rows else None
