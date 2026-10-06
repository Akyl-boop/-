"""Promo codes, referral program and reviews."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import func, select

from app.api.deps import DB, Paging, Perm, page_response, paginate
from app.api.serializers import promo_out, user_brief
from app.core.errors import Conflict, NotFound
from app.models import Order, Product, PromoCode, PromoUsage, Referral, ReferralReward, Review, User
from app.models.enums import PromoType, ReviewStatus
from app.services.audit import audit, diff, snapshot
from app.services.promo import promo_stats

router = APIRouter(tags=["marketing"])


class PromoIn(BaseModel):
    code: str = Field(min_length=2, max_length=48, pattern=r"^[A-Za-z0-9_\-]+$")
    description: str | None = Field(None, max_length=255)
    type: PromoType
    value: Decimal = Field(gt=0)
    max_discount: Decimal | None = Field(None, ge=0)
    min_purchase: Decimal | None = Field(None, ge=0)
    max_uses: int | None = Field(None, ge=1)
    max_uses_per_user: int | None = Field(None, ge=1)
    starts_at: datetime | None = None
    expires_at: datetime | None = None
    product_ids: list[int] = Field(default_factory=list)
    category_ids: list[int] = Field(default_factory=list)
    user_ids: list[int] = Field(default_factory=list)
    new_customers_only: bool = False
    enabled: bool = True

    @model_validator(mode="after")
    def _check(self) -> PromoIn:
        if self.type == PromoType.PERCENT and self.value > 100:
            raise ValueError("Percentage cannot exceed 100")
        if self.starts_at and self.expires_at and self.starts_at >= self.expires_at:
            raise ValueError("Expiration must be after start date")
        return self


@router.get("/promo-codes")
async def list_promos(session: DB, auth: Perm("promo.manage"), paging: Paging, q: str | None = None,
                      enabled: bool | None = None) -> dict[str, Any]:
    query = select(PromoCode).order_by(PromoCode.created_at.desc())
    if q:
        query = query.where(PromoCode.code.ilike(f"%{q.strip()}%"))
    if enabled is not None:
        query = query.where(PromoCode.enabled.is_(enabled))
    items, total = await paginate(session, query, paging)
    stats = {pid: (n, d, r) for pid, n, d, r in (await session.execute(
        select(PromoUsage.promo_id, func.count(), func.coalesce(func.sum(PromoUsage.discount), 0),
               func.coalesce(func.sum(PromoUsage.order_total), 0))
        .where(PromoUsage.promo_id.in_([p.id for p in items] or [0])).group_by(PromoUsage.promo_id))).all()}
    out = []
    for p in items:
        d = promo_out(p)
        n, disc, rev = stats.get(p.id, (0, 0, 0))
        d["stats"] = {"uses": int(n), "discount_total": disc, "revenue": rev}
        out.append(d)
    return page_response(out, total, paging)


@router.post("/promo-codes", status_code=201)
async def create_promo(body: PromoIn, session: DB, auth: Perm("promo.manage")) -> dict[str, Any]:
    code = body.code.upper()
    if (await session.execute(select(PromoCode).where(func.upper(PromoCode.code) == code))).first():
        raise Conflict("Promo code already exists")
    p = PromoCode(**{**body.model_dump(), "code": code})
    session.add(p)
    await session.flush()
    await audit(session, auth.admin, "promo.create", f"Created promo code {code}", entity_type="promo", entity_id=p.id,
                new=body.model_dump())
    return promo_out(p)


@router.get("/promo-codes/{promo_id}")
async def get_promo(promo_id: int, session: DB, auth: Perm("promo.manage")) -> dict[str, Any]:
    p = await session.get(PromoCode, promo_id)
    if p is None:
        raise NotFound("Promo code not found")
    usages = (await session.execute(select(PromoUsage).where(PromoUsage.promo_id == p.id)
                                    .order_by(PromoUsage.created_at.desc()).limit(100))).scalars().all()
    users = {u.id: u for u in (await session.execute(select(User).where(User.id.in_([u.user_id for u in usages] or [0])))).scalars()}
    orders = {o.id: o.number for o in (await session.execute(select(Order).where(Order.id.in_([u.order_id for u in usages] or [0])))).scalars()}
    return {**promo_out(p), "stats": await promo_stats(session, p.id),
            "usages": [{"id": u.id, "customer": user_brief(users[u.user_id]) if u.user_id in users else None,
                        "order_id": u.order_id, "order_number": orders.get(u.order_id), "discount": u.discount,
                        "order_total": u.order_total, "created_at": u.created_at} for u in usages]}


@router.put("/promo-codes/{promo_id}")
async def update_promo(promo_id: int, body: PromoIn, session: DB, auth: Perm("promo.manage")) -> dict[str, Any]:
    p = await session.get(PromoCode, promo_id)
    if p is None:
        raise NotFound("Promo code not found")
    fields = list(body.model_dump().keys())
    old = snapshot(p, fields)
    for k, v in body.model_dump().items():
        setattr(p, k, v.upper() if k == "code" else v)
    o, n = diff(old, snapshot(p, fields))
    await audit(session, auth.admin, "promo.update", f"Updated promo code {p.code}", entity_type="promo", entity_id=p.id, old=o, new=n)
    return promo_out(p)


@router.delete("/promo-codes/{promo_id}")
async def delete_promo(promo_id: int, session: DB, auth: Perm("promo.manage")) -> dict[str, str]:
    p = await session.get(PromoCode, promo_id)
    if p is None:
        raise NotFound("Promo code not found")
    if p.uses_count:
        p.enabled = False
        await audit(session, auth.admin, "promo.disable", f"Disabled used promo code {p.code}", entity_type="promo", entity_id=p.id)
        return {"status": "disabled"}
    await session.delete(p)
    await audit(session, auth.admin, "promo.delete", f"Deleted promo code {p.code}", entity_type="promo", entity_id=p.id)
    return {"status": "deleted"}


# ─── Referrals ──────────────────────────────────────────────────────────────


@router.get("/referrals/overview")
async def referral_overview(session: DB, auth: Perm("referrals.manage")) -> dict[str, Any]:
    totals = (await session.execute(select(func.count(Referral.id), func.count(Referral.converted_at),
                                           func.coalesce(func.sum(Referral.revenue), 0),
                                           func.coalesce(func.sum(Referral.reward_total), 0)))).one()
    referrers = (await session.execute(select(func.count(func.distinct(Referral.referrer_id))))).scalar_one()
    top = (await session.execute(
        select(Referral.referrer_id, func.count(Referral.id), func.count(Referral.converted_at),
               func.sum(Referral.revenue), func.sum(Referral.reward_total))
        .group_by(Referral.referrer_id).order_by(func.sum(Referral.revenue).desc().nulls_last()).limit(15)
    )).all()
    users = {u.id: u for u in (await session.execute(select(User).where(User.id.in_([t[0] for t in top] or [0])))).scalars()}
    links = (await session.execute(select(func.count(User.id)))).scalar_one()
    return {
        "referral_links": int(links), "referrers": int(referrers), "registered": int(totals[0]), "converted": int(totals[1]),
        "revenue": totals[2], "rewards": totals[3],
        "conversion_rate": round(int(totals[1]) / int(totals[0]) * 100, 1) if totals[0] else 0,
        "top_referrers": [{"customer": user_brief(users[t[0]]) if t[0] in users else None, "registered": int(t[1]),
                           "converted": int(t[2]), "revenue": t[3] or 0, "rewards": t[4] or 0} for t in top],
    }


@router.get("/referrals")
async def list_referrals(session: DB, auth: Perm("referrals.manage"), paging: Paging) -> dict[str, Any]:
    items, total = await paginate(session, select(Referral).order_by(Referral.created_at.desc()), paging)
    return page_response([{"id": r.id, "referrer": user_brief(r.referrer), "referred": user_brief(r.referred),
                           "converted_at": r.converted_at, "revenue": r.revenue, "reward_total": r.reward_total,
                           "created_at": r.created_at} for r in items], total, paging)


@router.get("/referrals/rewards")
async def list_rewards(session: DB, auth: Perm("referrals.manage"), paging: Paging) -> dict[str, Any]:
    items, total = await paginate(session, select(ReferralReward).order_by(ReferralReward.created_at.desc()), paging)
    return page_response([{"id": r.id, "referral_id": r.referral_id, "order_id": r.order_id, "amount": r.amount,
                           "created_at": r.created_at} for r in items], total, paging)


# ─── Reviews ────────────────────────────────────────────────────────────────


async def _recalc_rating(session: Any, product_id: int) -> None:
    avg, cnt = (await session.execute(select(func.avg(Review.rating), func.count(Review.id))
                                      .where(Review.product_id == product_id, Review.status == ReviewStatus.APPROVED))).one()
    p = await session.get(Product, product_id)
    if p is not None:
        p.rating_avg = Decimal(str(round(float(avg), 2))) if avg else None
        p.rating_count = int(cnt)


@router.get("/reviews")
async def list_reviews(session: DB, auth: Perm("reviews.manage"), paging: Paging, status: str | None = None,
                       product_id: int | None = None) -> dict[str, Any]:
    q = select(Review).order_by(Review.created_at.desc())
    if status:
        q = q.where(Review.status == status)
    if product_id:
        q = q.where(Review.product_id == product_id)
    items, total = await paginate(session, q, paging)
    users = {u.id: u for u in (await session.execute(select(User).where(User.id.in_([r.user_id for r in items] or [0])))).scalars()}
    prods = {p.id: p for p in (await session.execute(select(Product).where(Product.id.in_([r.product_id for r in items] or [0])))).scalars()}
    return page_response([{"id": r.id, "rating": r.rating, "text": r.text, "status": r.status.value,
                           "admin_reply": r.admin_reply, "order_id": r.order_id, "created_at": r.created_at,
                           "customer": user_brief(users[r.user_id]) if r.user_id in users else None,
                           "product": {"id": r.product_id, "name": prods[r.product_id].name,
                                       "emoji": prods[r.product_id].emoji} if r.product_id in prods else None}
                          for r in items], total, paging)


class ReviewIn(BaseModel):
    status: ReviewStatus | None = None
    admin_reply: str | None = Field(None, max_length=1000)


@router.patch("/reviews/{review_id}")
async def moderate_review(review_id: int, body: ReviewIn, session: DB, auth: Perm("reviews.manage")) -> dict[str, str]:
    r = await session.get(Review, review_id)
    if r is None:
        raise NotFound("Review not found")
    if body.status is not None:
        r.status = body.status
    if body.admin_reply is not None:
        r.admin_reply = body.admin_reply or None
    await session.flush()
    await _recalc_rating(session, r.product_id)
    await audit(session, auth.admin, "review.moderate", f"Review #{r.id} → {r.status.value}", entity_type="review", entity_id=r.id)
    return {"status": "ok"}


@router.delete("/reviews/{review_id}")
async def delete_review(review_id: int, session: DB, auth: Perm("reviews.manage")) -> dict[str, str]:
    r = await session.get(Review, review_id)
    if r is None:
        raise NotFound("Review not found")
    pid = r.product_id
    await session.delete(r)
    await session.flush()
    await _recalc_rating(session, pid)
    await audit(session, auth.admin, "review.delete", f"Deleted review #{review_id}", entity_type="review", entity_id=review_id)
    return {"status": "ok"}
