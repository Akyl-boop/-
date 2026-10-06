from app.security.html import sanitize_telegram_html, strip_custom_emoji
from app.security.passwords import hash_password, password_problems, verify_password
from app.services.texts import SafeHtml, render_template


def test_password_hashing_roundtrip() -> None:
    h = hash_password("CorrectHorse123")
    assert h.startswith("$argon2id$")
    assert verify_password("CorrectHorse123", h)
    assert not verify_password("wrong", h)
    assert not verify_password("anything", None)


def test_password_policy() -> None:
    assert password_problems("short1")
    assert password_problems("onlyletterslong")
    assert not password_problems("Letters12345")


def test_sanitizer_keeps_telegram_tags_and_strips_others() -> None:
    raw = '<b>Bold</b> <script>alert(1)</script><i>it</i> <a href="javascript:x">bad</a> <a href="https://ok.io">ok</a>'
    out = sanitize_telegram_html(raw)
    assert "<b>Bold</b>" in out and "<i>it</i>" in out
    assert "<script>" not in out and "javascript:" not in out
    assert '<a href="https://ok.io">ok</a>' in out


def test_sanitizer_closes_unclosed_tags_and_escapes() -> None:
    assert sanitize_telegram_html("<b>open") == "<b>open</b>"
    assert sanitize_telegram_html("1 < 2 & 3") == "1 &lt; 2 &amp; 3"


def test_custom_emoji_handling() -> None:
    html = sanitize_telegram_html('<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji> ok')
    assert 'emoji-id="5368324170671202286"' in html
    assert strip_custom_emoji(html) == "👍 ok"
    assert "tg-emoji" not in sanitize_telegram_html('<tg-emoji emoji-id="abc">x</tg-emoji>')


def test_template_escapes_values_but_not_safe_html() -> None:
    out = render_template("Hi {name}! {block} {missing}", {"name": "<b>x</b>", "block": SafeHtml("<i>ok</i>")})
    assert out == "Hi &lt;b&gt;x&lt;/b&gt;! <i>ok</i> {missing}"
