"""Impact calculations. Decimal throughout; nothing is estimated when an input is missing.

- Days of cover needs usable stock and a demand rate above zero.
- At-risk volume, availability gap and incremental cost need an approved disruption assumption.
- Incremental cost is quantity at risk times the price difference to the reference option,
  rounded half up to a whole currency unit. It excludes freight and other costs.
- The gap is the reference option's lead time minus days of cover, floored at zero. It is a
  material availability gap, not a programme delay.
"""

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

ZERO = Decimal(0)
HUNDRED = Decimal(100)


@dataclass(frozen=True)
class Calc:
    cover_days: Decimal | None
    at_risk: Decimal | None
    gap_days: Decimal | None
    incremental_cost: Decimal | None
    reason: str | None


def d(value) -> Decimal:
    """Exact Decimal from a JSON number (via str, never via binary float)."""
    return Decimal(str(value))


def cover_days(usable_stock: Decimal, demand_per_day: Decimal) -> Decimal | None:
    return usable_stock / demand_per_day if demand_per_day > ZERO else None


def calculate(
    *,
    usable_stock: Decimal,
    demand_per_day: Decimal,
    baseline_price: Decimal,
    exposed_value: Decimal,
    approved_share_pct: Decimal | None,
    unavailable_reason: str | None,
    reference_lead_days: int | None,
    reference_price: Decimal | None,
) -> Calc:
    cover = cover_days(usable_stock, demand_per_day)
    if approved_share_pct is None:
        return Calc(cover, None, None, None, unavailable_reason or "Needs an approved disruption assumption.")
    at_risk = exposed_value * approved_share_pct / HUNDRED
    gap = max(ZERO, Decimal(reference_lead_days) - cover) if cover is not None and reference_lead_days is not None else None
    cost = (
        (at_risk * (reference_price - baseline_price)).quantize(Decimal(1), rounding=ROUND_HALF_UP)
        if reference_price is not None
        else None
    )
    return Calc(cover, at_risk, gap, cost, None)
