"""Customer lifecycle: registration from Telegram, CRM timeline, balance, bans, referrals linking."""

from __future__ import annotations

from decimal import Decimal
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ValidationFailed
from app.core.utils import money, random_code, utcnow
from app.models import BalanceTransaction, CustomerEvent, Referral, User
from app.models.enums import BalanceTxType
from app.services.notifications import notify
from app.services.settings import settings_store


async def add_event(
    session: AsyncSession, user_id: int, type_: str, message: str, data: dict[str, Any] | None = None,
    admin_id: int | None = None,
) -> None:
    session.add(CustomerEvent(user_id=user_id, type=type_, message=message[:500], data=data, admin_id=admin_id))


async def _unique_referral_code(session: AsyncSession) -> str:
    for _ in range(10):
        code = random_code(8)
        exists = (await session.execute(select(User.id).where(User.referral_code == code))).first()
        if not exists:
            return code
    raise RuntimeError("Could not generate referral code")


async def detect_language(language_code: str | None) -> str:
    loc = await settings_store.group("localization")
    from app.services.texts import text_store

    enabled = {lang["code"] for lang in await text_store.languages()}
    if loc.get("auto_detect", True) and language_code:
        base = language_code.split("-")[0].lower()
        if base in enabled:
            return base
    default = loc.get("default_language", "en")
    return default if default in enabled or not enabled else next(iter(enabled))


async def get_or_register(
    session: AsyncSession,
    *,
    telegram_id: int,
    username: str | None,
    first_name: str | None,
    last_name: str | None,
    language_code: str | None,
    is_premium: bool = False,
    start_param: str | None = None,
) -> tuple[User, bool]:
    """Return (user, created). Updates profile data on each call."""
    user = (await session.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
    now = utcnow()
    if user is not None:
        changed = (
            user.username != username or user.first_name != first_name or user.last_name != last_name
            or user.is_premium != bool(is_premium)
        )
        if changed:
            user.username, user.first_name, user.last_name = username, first_name, last_name
            user.is_premium = bool(is_premium)
        user.language_code = language_code
        if user.bot_blocked:
            user.bot_blocked = False
        if user.last_activity_at is None or (now - user.last_activity_at).total_seconds() > 60:
            user.last_activity_at = now
        return user, False

    lang = await detect_language(language_code)
    stmt = (
        insert(User)
        .values(
            telegram_id=telegram_id, username=username, first_name=first_name, last_name=last_name,
            language_code=language_code, language=lang, is_premium=bool(is_premium),
            referral_code=await _unique_referral_code(session), start_param=(start_param or "")[:64] or None,
            last_activity_at=now,
        )
        .on_conflict_do_nothing(index_elements=[User.telegram_id])
        .returning(User.id)
    )
    new_id = (await session.execute(stmt)).scalar_one_or_none()
    user = (await session.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one()
    if new_id is None:  # concurrent registration
        return user, False

    await add_event(session, user.id, "registered", "Registered via Telegram bot",
                    {"start_param": start_param} if start_param else None)
    if start_param and start_param.startswith("ref_"):
        await link_referral(session, user, start_param[4:])
    await notify(
        session, "new_customer", "New customer",
        f"{user.display_name} (@{username})" if username else user.display_name,
        link=f"/customers/{user.id}", telegram_vars={"customer": _customer_line(user)},
        data={"user_id": user.id},
    )
    return user, True


def _customer_line(user: User) -> str:
    return f"{user.display_name}" + (f" @{user.username}" if user.username else "") + f" · {user.telegram_id}"


customer_line = _customer_line


async def link_referral(session: AsyncSession, user: User, code: str) -> None:
    if not await settings_store.feature("referrals"):
        return
    referrer = (await session.execute(select(User).where(User.referral_code == code.upper()))).scalar_one_or_none()
    if referrer is None or referrer.id == user.id:
        return
    user.referred_by_id = referrer.id
    session.add(Referral(referrer_id=referrer.id, referred_id=user.id))
    await add_event(session, referrer.id, "referral", f"Invited {user.display_name}", {"referred_id": user.id})


async def adjust_balance(
    session: AsyncSession,
    user_id: int,
    amount: Decimal,
    tx_type: BalanceTxType,
    *,
    order_id: int | None = None,
    admin_id: int | None = None,
    note: str | None = None,
) -> Decimal:
    """Atomically change a balance (row-level UPDATE with non-negative guard). Returns new balance."""
    amount = money(amount)
    if amount == 0:
        user = await session.get(User, user_id)
        return user.balance if user else Decimal("0")
    result = await session.execute(
        update(User)
        .where(User.id == user_id, User.balance + amount >= 0)
        .values(balance=User.balance + amount)
        .returning(User.balance)
    )
    new_balance = result.scalar_one_or_none()
    if new_balance is None:
        raise ValidationFailed("Insufficient balance", code="insufficient_balance")
    session.add(
        BalanceTransaction(user_id=user_id, amount=amount, balance_after=new_balance, type=tx_type,
                           order_id=order_id, admin_id=admin_id, note=note)
    )
    # keep identity map in sync
    user = await session.get(User, user_id)
    if user is not None:
        user.balance = new_balance
    return new_balance
