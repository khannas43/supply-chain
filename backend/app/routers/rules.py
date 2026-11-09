from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit, clock
from ..auth import Actor, require_role
from ..deps import get_session
from ..models import Rule, RuleVersion
from ..schemas import Commodity, DraftIn, RuleOut, RuleVersionOut, ThresholdOut

router = APIRouter(prefix="/api/rules", tags=["rules"])


def _key(v: str) -> tuple[int, ...]:
    return tuple(int(p) for p in v.split("."))


def _versions(session: Session, rule_id: str) -> list[RuleVersion]:
    return sorted(session.scalars(select(RuleVersion).where(RuleVersion.rule_id == rule_id)), key=lambda x: _key(x.v))


def _out(session: Session, rule: Rule) -> RuleOut:
    return RuleOut(
        id=rule.id, name=rule.name, commodity=rule.commodity,
        versions=[
            RuleVersionOut(
                v=x.v, status=x.status, thresholds=[ThresholdOut(**t) for t in x.thresholds], created_by=x.created_by,
                created_at=x.created_at, published_by=x.published_by, published_at=x.published_at,
            )
            for x in _versions(session, rule.id)
        ],
    )


def _check_value(label: str, unit: str, value: Decimal) -> None:
    """Thresholds are ordinal scores, percentages or durations. Reject values that make no sense."""
    if unit == "%" and not (0 <= value <= 100):
        raise HTTPException(422, f"{label}: a percentage must be between 0 and 100")
    if unit == "score" and (value != value.to_integral_value() or not (1 <= value <= 4)):
        raise HTTPException(422, f"{label}: a severity score is a whole number from 1 to 4")
    if unit in ("hours", "days") and value <= 0:
        raise HTTPException(422, f"{label}: must be greater than zero")


@router.get("", response_model=list[RuleOut])
def list_rules(commodity: Commodity | None = None, session: Session = Depends(get_session)) -> list[RuleOut]:
    query = select(Rule).order_by(Rule.commodity, Rule.name)
    if commodity:
        query = query.where(Rule.commodity == commodity)
    return [_out(session, r) for r in session.scalars(query)]


@router.post("/{rule_id}/draft", response_model=RuleOut)
def save_draft(
    rule_id: str,
    body: DraftIn,
    actor: Actor = Depends(require_role("analyst", "admin")),
    session: Session = Depends(get_session),
) -> RuleOut:
    """Change thresholds. Edits an existing draft in place; otherwise starts a new draft version.

    Published versions are never edited. Thresholds not named keep their current value.
    """
    rule = session.get(Rule, rule_id)
    if rule is None:
        raise HTTPException(404, f"Rule {rule_id} not found")
    versions = _versions(session, rule_id)
    latest = versions[-1]
    published = next((x for x in versions if x.status == "published"), latest)
    base = latest if latest.status == "draft" else published
    by_key = {t["key"]: dict(t) for t in base.thresholds}
    for t in body.thresholds:
        if t.key not in by_key:
            raise HTTPException(422, f"Unknown threshold: {t.key}")
        _check_value(by_key[t.key]["label"], by_key[t.key]["unit"], t.value)
        by_key[t.key]["value"] = float(t.value) if t.value != t.value.to_integral_value() else int(t.value)
    thresholds = [by_key[t["key"]] for t in base.thresholds]

    now = clock.now()
    if latest.status == "draft":
        latest.thresholds, latest.created_by, latest.created_at = thresholds, actor.name, now
        version = latest.v
    else:
        major, minor = _key(latest.v)
        version = f"{major}.{minor + 1}"
        session.add(RuleVersion(rule_id=rule_id, v=version, status="draft", thresholds=thresholds, created_by=actor.name, created_at=now))
    audit.record(session, actor.name, "rule.draft", rule_id, f"version {version}")
    session.commit()
    return _out(session, rule)


@router.post("/{rule_id}/versions/{version}/publish", response_model=RuleOut)
def publish(
    rule_id: str,
    version: str,
    actor: Actor = Depends(require_role("analyst", "admin")),
    session: Session = Depends(get_session),
) -> RuleOut:
    """Publish a draft. The previously published version becomes superseded."""
    rule = session.get(Rule, rule_id)
    target = session.get(RuleVersion, (rule_id, version)) if rule else None
    if rule is None or target is None:
        raise HTTPException(404, f"Rule {rule_id} version {version} not found")
    if target.status != "draft":
        raise HTTPException(409, f"Only a draft can be published; this version is {target.status}")
    for other in session.scalars(select(RuleVersion).where(RuleVersion.rule_id == rule_id, RuleVersion.status == "published")):
        other.status = "superseded"
    session.flush()  # free the one-published slot before publishing
    target.status, target.published_by, target.published_at = "published", actor.name, clock.now()
    audit.record(session, actor.name, "rule.published", rule_id, f"version {version}")
    session.commit()
    return _out(session, rule)
