"""Telegram-HTML sanitizer.

Admins write bot texts using the subset of HTML that Telegram supports. Everything is
validated server-side so a malformed or malicious snippet can never break message
delivery (Telegram rejects messages with invalid markup) or inject unsupported tags.
"""

from __future__ import annotations

import html
import re
from html.parser import HTMLParser

ALLOWED_TAGS: dict[str, set[str]] = {
    "b": set(), "strong": set(), "i": set(), "em": set(), "u": set(), "ins": set(),
    "s": set(), "strike": set(), "del": set(), "code": {"class"}, "pre": set(),
    "a": {"href"}, "tg-spoiler": set(), "blockquote": {"expandable"},
    "tg-emoji": {"emoji-id"}, "span": {"class"},
}
_SAFE_URL = re.compile(r"^(https?://|tg://|mailto:)", re.IGNORECASE)


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.stack: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag not in ALLOWED_TAGS:
            return
        allowed = ALLOWED_TAGS[tag]
        parts = [tag]
        for name, value in attrs:
            if name not in allowed:
                continue
            if tag == "span" and value != "tg-spoiler":
                continue
            if tag == "a" and (not value or not _SAFE_URL.match(value)):
                continue
            if tag == "tg-emoji" and (not value or not value.isdigit()):
                return
            if tag == "code" and value and not re.fullmatch(r"language-[\w+-]+", value):
                continue
            parts.append(f'{name}="{html.escape(value or "", quote=True)}"' if value is not None else name)
        if tag == "a" and len(parts) == 1:
            return  # link without a safe href → drop the tag, keep text
        self.out.append("<" + " ".join(parts) + ">")
        self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in self.stack:
            # close any unclosed inner tags first to keep nesting valid
            while self.stack:
                t = self.stack.pop()
                self.out.append(f"</{t}>")
                if t == tag:
                    break

    def handle_data(self, data: str) -> None:
        self.out.append(html.escape(data, quote=False))

    def close(self) -> None:
        super().close()
        while self.stack:
            self.out.append(f"</{self.stack.pop()}>")


def sanitize_telegram_html(value: str | None) -> str:
    if not value:
        return ""
    parser = _Sanitizer()
    parser.feed(value)
    parser.close()
    return "".join(parser.out)


def strip_custom_emoji(value: str) -> str:
    """Replace <tg-emoji> with its fallback emoji (for bots that cannot send custom emoji)."""
    return re.sub(r"<tg-emoji[^>]*>(.*?)</tg-emoji>", r"\1", value, flags=re.DOTALL)


def html_to_plain(value: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", value or ""))


def escape(value: object) -> str:
    return html.escape(str(value) if value is not None else "", quote=False)
