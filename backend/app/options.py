"""Eligibility and ranking of response options.

Options are filtered by qualification, specification and quote validity before they are ranked.
Unknown qualification is not approved. Inventory options extend cover; they are not ranked
against sourcing or logistics.
"""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .models import ResponseOption

EXPIRING_DAYS = 14


def ineligible_reasons(o: ResponseOption, today: date) -> list[str]:
    reasons = []
    if o.qualification == "unknown":
        reasons.append("Qualification not on file. Unknown qualification is not approved.")
    elif o.qualification == "expired":
        reasons.append("Qualification expired.")
    if o.spec_fit == "unknown":
        reasons.append("Specification fit unknown.")
    elif o.spec_fit == "partial":
        reasons.append("Specification only partly met.")
    if o.quote_valid_until is not None and o.quote_valid_until < today:
        reasons.append(f"Quote expired on {o.quote_valid_until.isoformat()}.")
    return reasons


def quote_status(o: ResponseOption, today: date) -> tuple[str, int | None]:
    if o.quote_valid_until is None:
        return "none", None
    days = (o.quote_valid_until - today).days
    if days < 0:
        return "expired", days
    return ("expiring" if days <= EXPIRING_DAYS else "valid"), days


@dataclass
class Scored:
    option: ResponseOption
    gap_days: Decimal | None = None
    incremental_cost: Decimal | None = None
    extra_cover_days: Decimal | None = None


def rank_key(s: Scored):
    inf = Decimal("Infinity")
    return (s.gap_days if s.gap_days is not None else inf, s.incremental_cost if s.incremental_cost is not None else inf, s.option.lead_time_days, s.option.id)
