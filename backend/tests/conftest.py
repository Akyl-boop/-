"""Test fixtures: isolated PostgreSQL database + Redis DB, fresh schema per session."""

from __future__ import annotations

import os

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql+asyncpg://shop:shop@localhost:5432/shop_test")
os.environ["REDIS_URL"] = os.environ.get("TEST_REDIS_URL", "redis://localhost:6379/15")
os.environ["ENVIRONMENT"] = "test"
os.environ["BOT_TOKEN"] = ""
os.environ["LOG_JSON"] = "false"

from collections.abc import AsyncIterator  # noqa: E402
from decimal import Decimal  # noqa: E402

import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import text  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession  # noqa: E402

from app.core.database import SessionLocal, engine  # noqa: E402
from app.core.redis import redis  # noqa: E402
from app.models import Base, Product, ProductVariant, User  # noqa: E402
from app.models.enums import DeliveryMode, ProductStatus, StockMode  # noqa: E402


@pytest_asyncio.fixture(scope="session", autouse=True)
async def schema() -> AsyncIterator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        for seq, start in (("order_number_seq", 10001), ("ticket_number_seq", 1001)):
            await conn.execute(text(f"DROP SEQUENCE IF EXISTS {seq}"))
            await conn.execute(text(f"CREATE SEQUENCE {seq} START {start}"))
        await conn.run_sync(Base.metadata.create_all)
    await redis.flushdb()
    from app.core.database import session_scope
    from app.services.seed import create_admin, seed_core

    async with session_scope() as s:
        await seed_core(s)
        await create_admin(s, "owner@test.dev", "Owner", "OwnerPass12345", "owner")
        await create_admin(s, "analyst@test.dev", "Analyst", "AnalystPass12345", "analyst")
    yield
    await engine.dispose()


@pytest_asyncio.fixture
async def session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as s:
        yield s
        await s.rollback()


_counter = {"n": 0}


@pytest_asyncio.fixture
async def make_user():
    async def _make(**kw) -> User:
        from app.core.utils import random_code

        _counter["n"] += 1
        async with SessionLocal() as s:
            u = User(telegram_id=900_000_000 + _counter["n"] + int.from_bytes(os.urandom(2), "big") * 1000,
                     first_name=kw.pop("first_name", "Test"), referral_code=random_code(10), language="en", **kw)
            s.add(u)
            await s.commit()
            return u

    return _make


@pytest_asyncio.fixture
async def make_product():
    async def _make(*, price: str = "10.00", stock_mode: StockMode = StockMode.INVENTORY,
                    delivery: DeliveryMode = DeliveryMode.INVENTORY, codes: int = 0, manual_stock: int = 0,
                    config: dict | None = None) -> tuple[Product, ProductVariant]:
        from app.core.utils import random_code
        from app.services import inventory as inv

        async with SessionLocal() as s:
            slug = "p-" + random_code(8).lower()
            p = Product(slug=slug, name={"en": f"Product {slug}"}, status=ProductStatus.ACTIVE, stock_mode=stock_mode,
                        delivery_mode=delivery, fulfillment_config=config or {})
            v = ProductVariant(sku=f"SKU-{random_code(8)}", name={"en": "Standard"}, price=Decimal(price),
                               is_default=True, manual_stock=manual_stock)
            p.variants = [v]
            s.add(p)
            await s.flush()
            if codes:
                await inv.add_items(s, v, [f"CODE-{slug}-{i}" for i in range(codes)])
            await s.commit()
            return p, v

    return _make


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
