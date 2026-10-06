"""Direct blockchain payments: USDT TRC20, USDT BEP20, LTC, TON.

Matching strategy (prevents attributing unrelated transfers to an order):

* **Unique amount** (default): each pending payment to a shared wallet gets a unique amount
  (a few extra minor units). A transfer matches only if it goes *to* the wallet, uses the
  right token contract / network, has *exactly* that amount, happened within the payment's
  time window and its tx hash has never been used before (DB unique index).
* **Address pool**: a dedicated address from the pool is assigned to the payment for its
  lifetime; amount must be ≥ the expected amount.
* **TON**: matched by the payment reference in the transfer comment + amount.

Confirmations are configurable per method.
"""

from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from decimal import ROUND_UP, Decimal
from typing import Any

import httpx
from sqlalchemy import select

from app.core.database import SessionLocal
from app.core.logging import get_logger
from app.core.redis import redis
from app.models import Payment
from app.models.enums import PaymentStatus
from app.payments.base import (
    ConfigField,
    PaymentContext,
    PaymentCreated,
    PaymentProvider,
    ProviderResult,
    ProviderUnavailable,
)
from app.payments.rates import convert
from app.services.settings import settings_store

log = get_logger(__name__)

NETWORKS: dict[str, dict[str, Any]] = {
    "TRC20": {"asset": "USDT", "decimals": 6, "display": "TRON (TRC20)", "unique_places": 4,
              "contract": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"},
    "BEP20": {"asset": "USDT", "decimals": 18, "display": "BNB Smart Chain (BEP20)", "unique_places": 4,
              "contract": "0x55d398326f99059fF775485246999027B3197955"},
    "LTC": {"asset": "LTC", "decimals": 8, "display": "Litecoin", "unique_places": 6},
    "TON": {"asset": "TON", "decimals": 9, "display": "TON", "unique_places": 3},
}
GRACE = timedelta(minutes=10)


def _match_amount(expected: Decimal, received: Decimal, mode: str, places: int) -> bool:
    if mode == "unique_amount":
        q = Decimal(1).scaleb(-places)
        return received.quantize(q) == expected.quantize(q)
    return received >= expected


class CryptoDirectProvider(PaymentProvider):
    code = "crypto_direct"
    title = "Direct crypto (on-chain)"
    description = "Receive USDT (TRC20/BEP20), LTC or TON directly to your own wallet with automatic detection."
    supports_polling = True
    config_fields = [
        ConfigField("network", "Network", "select", required=True, default="TRC20",
                    options=[{"value": k, "label": v["display"] + f" · {v['asset']}"} for k, v in NETWORKS.items()]),
        ConfigField("wallet_address", "Receiving wallet address", "text", required=False,
                    help="Shared wallet for unique-amount matching. Not needed when using an address pool."),
        ConfigField("address_mode", "Address mode", "select", default="unique_amount",
                    options=[{"value": "unique_amount", "label": "Shared wallet · unique amount"},
                             {"value": "pool", "label": "Address pool · one address per payment"}]),
        ConfigField("confirmations", "Required confirmations", "number", default=1),
        ConfigField("expiry_minutes", "Payment window (minutes)", "number", default=30,
                    help="Leave 0 to use the global checkout timeout."),
    ]

    @property
    def network(self) -> str:
        return (self.public.get("network") or "TRC20").upper()

    @property
    def net(self) -> dict[str, Any]:
        if self.network not in NETWORKS:
            raise ProviderUnavailable(f"Unsupported network {self.network}")
        return NETWORKS[self.network]

    async def create_payment(self, ctx: PaymentContext) -> PaymentCreated:
        from app.payments.service import assign_pool_address  # local import (cycle)

        net = self.net
        mode = self.public.get("address_mode") or "unique_amount"
        if self.network == "TON":
            mode = "memo"
        base = await convert(ctx.payment.amount, ctx.order.currency, net["asset"])
        places = net["unique_places"]
        q = Decimal(1).scaleb(-places)
        base = base.quantize(q, rounding=ROUND_UP)
        memo = None
        address = self.public.get("wallet_address")
        if mode == "pool":
            address = await assign_pool_address(ctx.payment, self.network, ctx.expires_at)
            amount = base
        elif mode == "memo":
            memo = ctx.payment.reference
            amount = base
        else:
            if not address:
                raise ProviderUnavailable("Wallet address is not configured")
            amount = await self._unique_amount(address, base, places)
        if not address:
            raise ProviderUnavailable("No receiving address available")
        return PaymentCreated(
            kind="crypto",
            pay_amount=amount,
            pay_currency=net["asset"],
            network=self.network,
            address=address,
            memo=memo,
            expires_at=ctx.expires_at,
            extra={"match_mode": mode, "confirmations_required": int(self.public.get("confirmations") or 1),
                   "network_display": net["display"]},
        )

    async def _unique_amount(self, address: str, base: Decimal, places: int) -> Decimal:
        """Pick base + k·10^-places not used by any other open payment to the same address."""
        step = Decimal(1).scaleb(-places)
        async with SessionLocal() as s:
            used = set(
                (
                    await s.execute(
                        select(Payment.pay_amount).where(
                            Payment.address == address, Payment.network == self.network,
                            Payment.status.in_([PaymentStatus.PENDING, PaymentStatus.AWAITING_CONFIRMATION]),
                        )
                    )
                ).scalars()
            )
        used_q = {Decimal(u).quantize(step) for u in used if u is not None}
        for _ in range(200):
            k = secrets.randbelow(999) + 1
            candidate = (base + step * k).quantize(step)
            if candidate in used_q:
                continue
            # Claim the amount in Redis so concurrent checkouts can never pick the same one.
            claimed = await redis.set(f"crypto-amt:{self.network}:{address}:{candidate}", "1", nx=True,
                                      ex=int(GRACE.total_seconds()) + 6 * 3600)
            if claimed:
                return candidate
        raise ProviderUnavailable("Too many concurrent payments — try again in a minute")

    # ── Chain clients ───────────────────────────────────────────────────────

    async def _secret(self, name: str) -> str | None:
        return await settings_store.secret("integration_secrets", name)

    async def _transfers(self, payment: Payment) -> list[dict[str, Any]]:
        """Return incoming transfers to the payment address: [{hash, amount, ts, confirmations, memo}]."""
        address = payment.address or ""
        since = payment.created_at - timedelta(minutes=2)
        net = self.net
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                if self.network == "TRC20":
                    return await self._tron(client, address, since, net)
                if self.network == "BEP20":
                    return await self._bsc(client, address, since, net)
                if self.network == "LTC":
                    return await self._ltc(client, address, since, net)
                if self.network == "TON":
                    return await self._ton(client, address, since, net)
        except ProviderUnavailable:
            raise
        except Exception as exc:
            raise ProviderUnavailable(f"Blockchain API error: {exc}") from exc
        return []

    async def _tron(self, client: httpx.AsyncClient, address: str, since: datetime, net: dict) -> list[dict]:
        headers = {}
        if key := await self._secret("trongrid_api_key"):
            headers["TRON-PRO-API-KEY"] = key
        out: list[dict] = []
        for confirmed in (True, False):
            params: dict[str, Any] = {
                "only_to": "true", "limit": 50, "contract_address": net["contract"],
                "min_timestamp": int(since.timestamp() * 1000),
            }
            params["only_confirmed" if confirmed else "only_unconfirmed"] = "true"
            r = await client.get(f"https://api.trongrid.io/v1/accounts/{address}/transactions/trc20",
                                 params=params, headers=headers)
            r.raise_for_status()
            for tx in r.json().get("data", []):
                if tx.get("to") != address or (tx.get("token_info") or {}).get("address") != net["contract"]:
                    continue
                out.append({
                    "hash": tx["transaction_id"],
                    "amount": Decimal(tx["value"]).scaleb(-int((tx.get("token_info") or {}).get("decimals", 6))),
                    "ts": datetime.fromtimestamp(tx["block_timestamp"] / 1000, UTC),
                    "confirmations": 999 if confirmed else 0,
                })
        return out

    async def _bsc(self, client: httpx.AsyncClient, address: str, since: datetime, net: dict) -> list[dict]:
        key = await self._secret("etherscan_api_key")
        if not key:
            raise ProviderUnavailable("Etherscan API key (BscScan via Etherscan V2) is not configured")
        r = await client.get("https://api.etherscan.io/v2/api", params={
            "chainid": 56, "module": "account", "action": "tokentx", "contractaddress": net["contract"],
            "address": address, "page": 1, "offset": 100, "sort": "desc", "apikey": key,
        })
        r.raise_for_status()
        data = r.json()
        if data.get("status") != "1" and data.get("message") != "No transactions found":
            if isinstance(data.get("result"), str) and "rate limit" in data["result"].lower():
                raise ProviderUnavailable("Etherscan rate limit")
        out = []
        for tx in data.get("result") or []:
            if not isinstance(tx, dict) or tx.get("to", "").lower() != address.lower():
                continue
            if tx.get("contractAddress", "").lower() != net["contract"].lower():
                continue
            ts = datetime.fromtimestamp(int(tx["timeStamp"]), UTC)
            if ts < since:
                continue
            out.append({"hash": tx["hash"], "amount": Decimal(tx["value"]).scaleb(-int(tx.get("tokenDecimal") or 18)),
                        "ts": ts, "confirmations": int(tx.get("confirmations") or 0)})
        return out

    async def _ltc(self, client: httpx.AsyncClient, address: str, since: datetime, net: dict) -> list[dict]:
        params: dict[str, Any] = {"limit": 50}
        if token := await self._secret("blockcypher_token"):
            params["token"] = token
        r = await client.get(f"https://api.blockcypher.com/v1/ltc/main/addrs/{address}", params=params)
        r.raise_for_status()
        data = r.json()
        out = []
        for ref in (data.get("txrefs") or []) + (data.get("unconfirmed_txrefs") or []):
            if ref.get("tx_input_n", -1) != -1:  # outputs received have tx_input_n == -1
                continue
            raw_ts = ref.get("confirmed") or ref.get("received")
            ts = datetime.fromisoformat(raw_ts.replace("Z", "+00:00")) if raw_ts else datetime.now(UTC)
            if ts < since:
                continue
            out.append({"hash": ref["tx_hash"], "amount": Decimal(ref["value"]).scaleb(-8), "ts": ts,
                        "confirmations": int(ref.get("confirmations") or 0)})
        return out

    async def _ton(self, client: httpx.AsyncClient, address: str, since: datetime, net: dict) -> list[dict]:
        headers = {}
        if key := await self._secret("toncenter_api_key"):
            headers["X-API-Key"] = key
        r = await client.get("https://toncenter.com/api/v2/getTransactions",
                             params={"address": address, "limit": 50, "archival": "false"}, headers=headers)
        r.raise_for_status()
        out = []
        for tx in r.json().get("result", []):
            msg = tx.get("in_msg") or {}
            if not msg.get("source") or int(msg.get("value") or 0) <= 0:
                continue
            ts = datetime.fromtimestamp(int(tx["utime"]), UTC)
            if ts < since:
                continue
            out.append({"hash": tx["transaction_id"]["hash"], "amount": Decimal(msg["value"]).scaleb(-9), "ts": ts,
                        "confirmations": 1, "memo": (msg.get("message") or "").strip()})
        return out

    async def check_payment(self, payment: Payment) -> ProviderResult | None:
        if not payment.address or payment.pay_amount is None:
            return None
        transfers = await self._transfers(payment)
        mode = (payment.extra or {}).get("match_mode", "unique_amount")
        required = int((payment.extra or {}).get("confirmations_required") or self.public.get("confirmations") or 1)
        places = self.net["unique_places"]
        window_end = (payment.expires_at or payment.created_at + timedelta(hours=1)) + GRACE
        used_hashes = await self._used_hashes([t["hash"] for t in transfers], payment)
        best: dict[str, Any] | None = None
        for tx in transfers:
            if tx["hash"] in used_hashes:
                continue
            if not (payment.created_at - timedelta(minutes=2) <= tx["ts"] <= window_end):
                continue
            if mode == "memo":
                if tx.get("memo") != payment.memo or tx["amount"] < payment.pay_amount:
                    continue
            elif not _match_amount(Decimal(payment.pay_amount), tx["amount"], mode, places):
                continue
            if best is None or tx["confirmations"] > best["confirmations"]:
                best = tx
        if best is None:
            return ProviderResult(status=PaymentStatus.PENDING)
        confirmations = min(best["confirmations"], 9999)
        status = PaymentStatus.PAID if confirmations >= required else PaymentStatus.AWAITING_CONFIRMATION
        return ProviderResult(
            status=status, tx_hash=best["hash"], confirmations=confirmations, received_amount=best["amount"],
            received_currency=self.net["asset"], paid_at=best["ts"],
            raw={"hash": best["hash"], "amount": str(best["amount"]), "confirmations": confirmations,
                 "network": self.network},
        )

    async def _used_hashes(self, hashes: list[str], payment: Payment) -> set[str]:
        if not hashes:
            return set()
        async with SessionLocal() as s:
            rows = await s.execute(
                select(Payment.tx_hash).where(Payment.network == self.network, Payment.tx_hash.in_(hashes),
                                              Payment.id != payment.id)
            )
            return {h for h in rows.scalars() if h}

    async def health_check(self) -> tuple[bool, str]:
        missing = []
        if (self.public.get("address_mode") or "unique_amount") == "unique_amount" and self.network != "TON" \
                and not self.public.get("wallet_address"):
            missing.append("wallet address")
        if self.network == "TON" and not self.public.get("wallet_address"):
            missing.append("wallet address")
        if self.network == "BEP20" and not await self._secret("etherscan_api_key"):
            missing.append("Etherscan API key")
        if missing:
            return False, "Missing: " + ", ".join(missing)
        return True, f"{self.net['display']} ready"
