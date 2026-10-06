"""Referral program: rewards on referred customers' paid orders (idempotent)."""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import on_commit
from app.core.utils import money, utcnow
from app.models import Order, Referral, ReferralReward, User
from app.models.enums import BalanceTxType
from app.services.customers import add_event, adjust_balance
from app.services.settings import settings_store


def compute_reward(cfg: dict, order_total: Decimal) -> Decimal:
    if cfg.get("min_purchase") and order_total < Decimal(str(cfg["min_purchase"])):
        return Decimal("0")
    if cfg.get("reward_type") == "fixed":
        return money(Decimal(str(cfg.get("reward_amount") or 0)))
    return money(order_total * Decimal(str(cfg.get("reward_percent") or 0)) / Decimal("100"))


async def reward_for_order(session: AsyncSession, order: Order) -> Decimal:
    if not await settings_store.feature("referrals"):
        return Decimal("0")
    referral = (
        await session.execute(select(Referral).where(Referral.referred_id == order.user_id).with_for_update(of=Referral))
    ).scalar_one_or_none()
    if referral is None:
        return Decimal("0")
    cfg = await settings_store.group("referrals")
    paid_amount = money(order.total + order.balance_used)
    first = referral.converted_at is None
    if first:
        referral.converted_at = utcnow()
        referral.first_order_id = order.id
    referral.revenue = money(referral.revenue + paid_amount)
    if cfg.get("first_order_only") and not first:
        return Decimal("0")
    exists = (
        await session.execute(
            select(ReferralReward.id).where(ReferralReward.referral_id == referral.id, ReferralReward.order_id == order.id)
        )
    ).first()
    if exists:
        return Decimal("0")
    max_rewards = int(cfg.get("max_rewards_per_referrer") or 0)
    if max_rewards:
        count = (
            await session.execute(
                select(func.count(ReferralReward.id)).join(Referral, Referral.id == ReferralReward.referral_id)
                .where(Referral.referrer_id == referral.referrer_id)
            )
        ).scalar_one()
        if count >= max_rewards:
            return Decimal("0")
    reward = compute_reward(cfg, paid_amount)
    if reward <= 0:
        return Decimal("0")
    session.add(ReferralReward(referral_id=referral.id, order_id=order.id, amount=reward))
    referral.reward_total = money(referral.reward_total + reward)
    await adjust_balance(session, referral.referrer_id, reward, BalanceTxType.REFERRAL, order_id=order.id,
                         note=f"Referral reward for order {order.number}")
    await add_event(session, referral.referrer_id, "referral_reward", f"Earned {reward} referral reward",
                    {"order_id": order.id})
    referrer = await session.get(User, referral.referrer_id)
    if referrer is not None:
        tg_id, lang = referrer.telegram_id, referrer.language

        async def _notify() -> None:
            from app.bot.notify import send_text
            from app.services.money import fmt
            from app.services.texts import t

            await send_text(tg_id, await t("referrals.reward_received", lang, amount=await fmt(reward)))

        on_commit(session, _notify)
    return reward
