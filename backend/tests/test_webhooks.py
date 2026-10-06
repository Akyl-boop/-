"""Payment webhooks: signature validation and duplicate protection; on-chain transfer matching."""

import hashlib
import hmac
import uuid
from datetime import timedelta
from decimal import Decimal

import orjson
import pytest
from sqlalchemy import select

from app.core.crypto import encrypt_json
from app.core.database import SessionLocal, session_scope
from app.core.errors import PaymentError
from app.core.utils import utcnow
from app.models import Order, Payment, PaymentMethod, User, WebhookEvent
from app.models.enums import OrderStatus, PaymentStatus
from app.payments import service as payments
from app.payments.providers.crypto_direct import CryptoDirectProvider
from app.services.orders import LineRequest, create_order

TOKEN = "12345:AAtest-token"


def _sign(body: bytes) -> str:
    return hmac.new(hashlib.sha256(TOKEN.encode()).digest(), body, hashlib.sha256).hexdigest()


async def _cryptobot_payment(make_user, make_product) -> tuple[int, uuid.UUID]:
    user = await make_user()
    _, variant = await make_product(codes=1)
    async with session_scope() as s:
        m = (await s.execute(select(PaymentMethod).where(PaymentMethod.code == "cryptobot"))).scalar_one()
        m.secret_config_enc = encrypt_json({"api_token": TOKEN})
        order = await create_order(s, await s.get(User, user.id), [LineRequest(variant.id, 1)])
        p = Payment(id=uuid.uuid4(), reference=payments.new_reference(), order_id=order.id, method_code="cryptobot",
                    provider="cryptobot", status=PaymentStatus.PENDING, amount=order.total, currency="USD",
                    external_id=str(uuid.uuid4().int % 10**9), extra={"kind": "redirect"})
        s.add(p)
        order.status = OrderStatus.AWAITING_PAYMENT
        return order.id, p.id


async def test_cryptobot_webhook_valid_and_duplicate(make_user, make_product) -> None:
    order_id, pid = await _cryptobot_payment(make_user, make_product)
    async with SessionLocal() as s:
        p = await s.get(Payment, pid)
    update_id = int(uuid.uuid4().int % 10**9)
    body = orjson.dumps({"update_id": update_id, "update_type": "invoice_paid", "request_date": utcnow().isoformat(),
                         "payload": {"invoice_id": int(p.external_id), "status": "paid", "payload": p.reference,
                                     "paid_asset": "USDT", "paid_amount": "10.0", "amount": str(p.amount), "fiat": "USD"}})
    headers = {"crypto-pay-api-signature": _sign(body)}
    async with session_scope() as s:
        r = await payments.handle_webhook(s, "cryptobot", headers, body)
    assert r.get("ok") and not r.get("duplicate")
    async with session_scope() as s:
        r2 = await payments.handle_webhook(s, "cryptobot", headers, body)
    assert r2.get("duplicate") is True
    async with SessionLocal() as s:
        assert (await s.get(Payment, pid)).status == PaymentStatus.PAID
        assert (await s.get(Order, order_id)).status == OrderStatus.PAID
        events = (await s.execute(select(WebhookEvent).where(WebhookEvent.event_id == str(update_id)))).scalars().all()
        assert len(events) == 1 and events[0].status == "processed"


async def test_cryptobot_webhook_invalid_signature(make_user, make_product) -> None:
    order_id, pid = await _cryptobot_payment(make_user, make_product)
    body = orjson.dumps({"update_id": 1, "update_type": "invoice_paid", "payload": {"invoice_id": 1}})
    with pytest.raises(PaymentError):
        async with session_scope() as s:
            await payments.handle_webhook(s, "cryptobot", {"crypto-pay-api-signature": "deadbeef"}, body)
    async with SessionLocal() as s:
        assert (await s.get(Payment, pid)).status == PaymentStatus.PENDING


def _crypto_payment(amount: str, created_minutes_ago: int = 5) -> Payment:
    now = utcnow()
    return Payment(id=uuid.uuid4(), reference="PTEST", order_id=1, method_code="usdt_trc20", provider="crypto_direct",
                   status=PaymentStatus.PENDING, amount=Decimal("10"), currency="USD", pay_amount=Decimal(amount),
                   pay_currency="USDT", network="TRC20", address="TADDR", created_at=now - timedelta(minutes=created_minutes_ago),
                   expires_at=now + timedelta(minutes=25), extra={"match_mode": "unique_amount", "confirmations_required": 1})


async def test_crypto_matching_rules(monkeypatch) -> None:
    provider = CryptoDirectProvider(PaymentMethod(code="usdt_trc20", provider="crypto_direct", name={}),
                                    {"network": "TRC20", "wallet_address": "TADDR", "confirmations": 1}, {})
    payment = _crypto_payment("10.0137")
    now = utcnow()
    transfers = [
        {"hash": "h-wrong-amount", "amount": Decimal("10.0136"), "ts": now, "confirmations": 999},
        {"hash": "h-too-early", "amount": Decimal("10.0137"), "ts": now - timedelta(hours=2), "confirmations": 999},
        {"hash": "h-good", "amount": Decimal("10.013700"), "ts": now - timedelta(minutes=1), "confirmations": 0},
    ]

    async def fake_transfers(p):
        return transfers

    async def no_used(hashes, p):
        return set()

    monkeypatch.setattr(provider, "_transfers", fake_transfers)
    monkeypatch.setattr(provider, "_used_hashes", no_used)
    r = await provider.check_payment(payment)
    assert r.status == PaymentStatus.AWAITING_CONFIRMATION and r.tx_hash == "h-good"
    transfers[2]["confirmations"] = 999
    r = await provider.check_payment(payment)
    assert r.status == PaymentStatus.PAID and r.tx_hash == "h-good"

    async def used(hashes, p):
        return {"h-good"}

    monkeypatch.setattr(provider, "_used_hashes", used)
    r = await provider.check_payment(payment)
    assert r.status == PaymentStatus.PENDING  # a tx hash can never pay two orders
