"""API: authentication, lockout, CSRF and RBAC."""

import httpx
import pytest_asyncio
from httpx import ASGITransport

from app.main import create_app


@pytest_asyncio.fixture
async def client():
    from app.core.redis import redis

    async for key in redis.scan_iter("rl:*"):
        await redis.delete(key)
    app = create_app()
    async with httpx.AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _login(c: httpx.AsyncClient, email: str, password: str) -> httpx.Response:
    return await c.post("/api/auth/login", json={"email": email, "password": password})


async def test_login_and_me(client) -> None:
    r = await _login(client, "owner@test.dev", "OwnerPass12345")
    assert r.status_code == 200 and r.json()["status"] == "ok"
    assert "nexa_sid" in client.cookies
    me = await client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["email"] == "owner@test.dev"


async def test_wrong_password_and_unauthenticated(client) -> None:
    r = await _login(client, "owner@test.dev", "nope-nope-nope")
    assert r.status_code == 401
    assert (await client.get("/api/orders")).status_code == 401


async def test_csrf_required_for_mutations(client) -> None:
    await _login(client, "owner@test.dev", "OwnerPass12345")
    r = await client.post("/api/tags", json={"name": "csrf-test", "color": "#112233"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"
    r = await client.post("/api/tags", json={"name": "csrf-test", "color": "#112233"},
                          headers={"X-CSRF-Token": client.cookies["nexa_csrf"]})
    assert r.status_code == 201


async def test_rbac_analyst_cannot_edit(client) -> None:
    await _login(client, "analyst@test.dev", "AnalystPass12345")
    csrf = {"X-CSRF-Token": client.cookies["nexa_csrf"]}
    assert (await client.get("/api/products")).status_code == 200
    r = await client.post("/api/categories", json={"name": {"en": "X"}}, headers=csrf)
    assert r.status_code == 403
    assert (await client.get("/api/admins")).status_code == 403


async def test_lockout_after_failed_attempts(client) -> None:
    from app.core.database import session_scope
    from app.services.seed import create_admin

    async with session_scope() as s:
        await create_admin(s, "lock@test.dev", "Lock", "LockPass12345", "support")
    for _ in range(5):
        await _login(client, "lock@test.dev", "bad-password-1")
    r = await _login(client, "lock@test.dev", "LockPass12345")
    assert r.status_code == 403 and r.json()["error"]["code"] == "account_locked"


async def test_validation_error_format(client) -> None:
    await _login(client, "owner@test.dev", "OwnerPass12345")
    r = await client.post("/api/promo-codes", json={"code": "!", "type": "percent", "value": 500},
                          headers={"X-CSRF-Token": client.cookies["nexa_csrf"]})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_failed"
