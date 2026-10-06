"""Drive the real aiogram dispatcher with a fake Telegram session: /start → catalog → product → buy → pay."""

from __future__ import annotations

import itertools
import typing
from datetime import UTC, datetime
from typing import Any

import pytest_asyncio
from aiogram import Bot
from aiogram.client.session.base import BaseSession
from aiogram.methods import TelegramMethod
from aiogram.types import CallbackQuery, Chat, Message, Update
from aiogram.types import User as TgUser
from sqlalchemy import select

from app.core.database import SessionLocal, session_scope
from app.models import Order, PaymentMethod
from app.models.enums import OrderStatus, PaymentStatus

BOT_ID = 777000
_ids = itertools.count(1000)


class FakeSession(BaseSession):
    """Records every Bot API call and returns plausible objects."""

    def __init__(self) -> None:
        super().__init__()
        self.calls: list[TelegramMethod[Any]] = []

    async def make_request(self, bot: Bot, method: TelegramMethod[Any], timeout: int | None = None) -> Any:  # noqa: ASYNC109
        self.calls.append(method)
        returning = method.__returning__
        if returning is Message or Message in typing.get_args(returning):
            chat_id = getattr(method, "chat_id", None) or 1
            data: dict[str, Any] = {"message_id": next(_ids), "date": datetime.now(UTC),
                                    "chat": Chat(id=int(chat_id), type="private"),
                                    "text": getattr(method, "text", None) or getattr(method, "caption", None) or "",
                                    "reply_markup": getattr(method, "reply_markup", None)}
            return Message(**data).as_(bot)
        if returning is TgUser:
            return TgUser(id=BOT_ID, is_bot=True, first_name="Shop", username="nexa_test_bot")
        return True

    async def close(self) -> None:  # pragma: no cover
        pass

    async def stream_content(self, *args: Any, **kwargs: Any):  # type: ignore[override]  # pragma: no cover
        yield b""


@pytest_asyncio.fixture
async def bot_env(monkeypatch):
    from app.bot.factory import build_dispatcher
    from app.bot.middlewares import core

    async def no_limit(*a, **k):
        return True, 99

    monkeypatch.setattr(core, "hit", no_limit)  # the throttle is tested separately; clicks here are machine-fast

    session = FakeSession()
    bot = Bot(token=f"{BOT_ID}:AAH_fake_token_for_tests_only_000000", session=session)
    dp = build_dispatcher()
    yield bot, dp, session


class Chatter:
    def __init__(self, bot: Bot, dp: Any, session: FakeSession, user_id: int) -> None:
        self.bot, self.dp, self.session, self.user_id = bot, dp, session, user_id
        self.update_id = itertools.count(1)
        self.user = TgUser(id=user_id, is_bot=False, first_name="Alice", username=f"alice{user_id}", language_code="en")
        self.chat = Chat(id=user_id, type="private")
        self.last_message: Message | None = None

    def _last_markup(self) -> Any:
        for call in reversed(self.session.calls):
            markup = getattr(call, "reply_markup", None)
            if markup is not None and hasattr(markup, "inline_keyboard"):
                return markup
        return None

    def buttons(self) -> list[tuple[str, str | None]]:
        markup = self._last_markup()
        return [(b.text, b.callback_data) for row in markup.inline_keyboard for b in row] if markup else []

    def last_text(self) -> str:
        for call in reversed(self.session.calls):
            t = getattr(call, "text", None) or getattr(call, "caption", None)
            if t:
                return t
        return ""

    async def send(self, text: str) -> None:
        msg = Message(message_id=next(_ids), date=datetime.now(UTC), chat=self.chat, from_user=self.user, text=text)
        await self.dp.feed_update(self.bot, Update(update_id=next(self.update_id), message=msg.as_(self.bot)))

    async def click(self, predicate: Any) -> str:
        btns = self.buttons()
        match = next((b for b in btns if b[1] and predicate(b)), None)
        assert match is not None, f"No matching button in {btns}; text={self.last_text()!r}"
        msg = Message(message_id=next(_ids), date=datetime.now(UTC), chat=self.chat,
                      from_user=TgUser(id=BOT_ID, is_bot=True, first_name="Shop"), text="screen",
                      reply_markup=self._last_markup())
        cb = CallbackQuery(id=str(next(_ids)), from_user=self.user, chat_instance="ci", data=match[1],
                           message=msg.as_(self.bot))
        await self.dp.feed_update(self.bot, Update(update_id=next(self.update_id), callback_query=cb.as_(self.bot)))
        return match[1]


async def test_full_purchase_flow(bot_env, make_product) -> None:
    bot, dp, session = bot_env
    async with session_scope() as s:
        m = (await s.execute(select(PaymentMethod).where(PaymentMethod.code == "manual"))).scalar_one()
        m.enabled = True
        from app.models import Category

        cat = Category(slug="flow-cat", name={"en": "Flow Category"}, emoji="🧪")
        s.add(cat)
        await s.flush()
        cat_id = cat.id
    product, variant = await make_product(price="9.99", codes=2)
    async with session_scope() as s:
        from app.models import Product

        p = await s.get(Product, product.id)
        p.category_id = cat_id

    chat = Chatter(bot, dp, session, user_id=55_000_001)
    await chat.send("/start")
    assert "Welcome" in chat.last_text()
    await chat.click(lambda b: b[1] == "n:catalog:0")
    assert "Catalog" in chat.last_text()
    await chat.click(lambda b: b[1].startswith(f"c:{cat_id}:"))
    await chat.click(lambda b: b[1].startswith(f"p:{product.id}:"))
    assert "9.99" in chat.last_text()
    await chat.click(lambda b: b[1].startswith("pa:buy:"))
    # Only one payment method enabled with configuration (manual) besides balance (0 balance) → payment screen directly
    text = chat.last_text()
    assert "Bank transfer" in text or "Payment" in text, text
    await chat.click(lambda b: b[1].startswith("py:paid:"))

    async with SessionLocal() as s:
        order = (await s.execute(select(Order).order_by(Order.id.desc()).limit(1))).scalar_one()
        assert order.status == OrderStatus.AWAITING_CONFIRMATION
        assert order.payments[-1].status == PaymentStatus.AWAITING_CONFIRMATION

    # Cart path: add to cart, open cart, apply invalid promo
    await chat.send("/catalog")
    await chat.click(lambda b: b[1].startswith(f"c:{cat_id}:"))
    await chat.click(lambda b: b[1].startswith(f"p:{product.id}:"))
    await chat.click(lambda b: b[1].startswith("pa:add:"))
    await chat.send("/cart")
    assert "Your cart" in chat.last_text()
    await chat.click(lambda b: b[1] == "ct:promo:0")
    await chat.send("NOPE")
    assert "doesn't exist" in chat.last_text()
    # Profile, orders, language switch, support, FAQ — every screen renders
    for target in ("n:profile:0", "n:orders:0", "n:lang:0"):
        await chat.send("/start")
        await chat.click(lambda b, t=target: b[1] == t)
    await chat.click(lambda b: b[1] == "l:ru")
    assert "Добро пожаловать" in chat.last_text() or "С возвращением" in chat.last_text()
    await chat.click(lambda b: b[1] == "s:home:0:0")
    await chat.click(lambda b: b[1] == "s:new:0:0")
    await chat.send("Help please")
    await chat.send("My code does not work")
    assert "T-" in chat.last_text()
    await chat.send("/start")
    await chat.click(lambda b: b[1] == "f:0")
    assert "?" in chat.last_text() or "вопрос" in chat.last_text().lower()
