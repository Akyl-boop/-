from datetime import timedelta
from decimal import Decimal

import pytest

from app.core.errors import PromoError
from app.core.utils import utcnow
from app.models import PromoCode
from app.models.enums import PromoType
from app.services.promo import PricedLine, calculate_discount, validate_promo


def promo(**kw) -> PromoCode:
    base = dict(code="X", type=PromoType.PERCENT, value=Decimal("10"), product_ids=[], category_ids=[], user_ids=[],
                enabled=True, uses_count=0, new_customers_only=False)
    base.update(kw)
    return PromoCode(**base)


def test_percent_discount() -> None:
    d, a = calculate_discount(promo(), [PricedLine(1, 1, Decimal("50")), PricedLine(2, 2, Decimal("30"))])
    assert d == Decimal("8.00") and a == Decimal("80")


def test_fixed_discount_never_exceeds_subtotal() -> None:
    d, _ = calculate_discount(promo(type=PromoType.FIXED, value=Decimal("100")), [PricedLine(1, None, Decimal("40"))])
    assert d == Decimal("40.00")


def test_max_discount_cap() -> None:
    d, _ = calculate_discount(promo(value=Decimal("50"), max_discount=Decimal("5")), [PricedLine(1, None, Decimal("100"))])
    assert d == Decimal("5.00")


def test_category_restriction() -> None:
    p = promo(category_ids=[7])
    d, a = calculate_discount(p, [PricedLine(1, 7, Decimal("20")), PricedLine(2, 8, Decimal("80"))])
    assert a == Decimal("20") and d == Decimal("2.00")


async def test_validation_errors(session, make_user) -> None:
    user = await make_user()
    lines = [PricedLine(1, None, Decimal("20"))]
    with pytest.raises(PromoError) as e:
        await validate_promo(session, None, user, lines)
    assert e.value.code == "promo.not_found"
    with pytest.raises(PromoError) as e:
        await validate_promo(session, promo(expires_at=utcnow() - timedelta(days=1)), user, lines)
    assert e.value.code == "promo.expired"
    with pytest.raises(PromoError) as e:
        await validate_promo(session, promo(max_uses=1, uses_count=1), user, lines)
    assert e.value.code == "promo.exhausted"
    with pytest.raises(PromoError) as e:
        await validate_promo(session, promo(min_purchase=Decimal("100")), user, lines)
    assert e.value.code == "promo.min_purchase"
    with pytest.raises(PromoError) as e:
        await validate_promo(session, promo(enabled=False), user, lines)
    assert e.value.code == "promo.disabled"
    result = await validate_promo(session, promo(), user, lines)
    assert result.discount == Decimal("2.00")
