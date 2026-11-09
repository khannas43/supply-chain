"""Processing of collected payloads: parse, map, normalise, validate, deduplicate, persist, evaluate.

NiFi will own collection; everything here (validation, identity resolution, business rules) stays in
Python so every source shares it and it can be tested on its own. Nothing here guesses: an
invalid or unresolvable record is quarantined with its reason, never repaired silently.
"""

import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Callable, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import alerting, audit, clock
from .collect import add_run
from .envelope import RawObjectEnvelope
from .ids import next_id
from .models import Country, CountryAlias, Ingestion, Observation, QuarantineItem, Source
from .storage import get_store, sha256

SUPPORTED_SCHEMA = 1
WHOLE_RECORD = "(whole record)"


class PermanentError(Exception):
    """The message cannot be processed however often it is retried; it goes to the dead-letter list."""


class RecordRejected(Exception):
    def __init__(self, reason: str, field: str = WHOLE_RECORD, bad_value: str = ""):
        super().__init__(reason)
        self.reason, self.field, self.bad_value = reason, field, bad_value


@dataclass
class Normalized:
    record_id: str
    commodity: str
    kind: str
    event_type: str
    country: str  # as received; resolved later
    value: Decimal | None
    headline: str
    published_at: datetime
    confidence_pct: int


class _Base(BaseModel):
    model_config = ConfigDict(extra="ignore")
    recordId: str = Field(min_length=1, max_length=100)
    commodity: Literal["wheat", "tungsten"]
    headline: str = Field(min_length=1)
    confidencePct: int = Field(ge=0, le=100)


class PolicyRecord(_Base):
    country: str = Field(min_length=1)
    policyType: str = Field(min_length=1)
    announcedAt: AwareDatetime


class LogisticsRecord(_Base):
    country: str = Field(min_length=1)
    eventType: str = Field(min_length=1)
    delayDays: Decimal = Field(ge=0)
    reportedAt: AwareDatetime


class PriceRecord(_Base):
    indicator: str = Field(min_length=1)
    value: Decimal
    observedAt: AwareDatetime


def _policy(r: PolicyRecord) -> Normalized:
    return Normalized(r.recordId, r.commodity, "policy", r.policyType, r.country, None, r.headline, r.announcedAt, r.confidencePct)


def _logistics(r: LogisticsRecord) -> Normalized:
    return Normalized(r.recordId, r.commodity, "logistics", r.eventType, r.country, r.delayDays, r.headline, r.reportedAt, r.confidencePct)


def _price(r: PriceRecord) -> Normalized:
    return Normalized(r.recordId, r.commodity, "price", r.indicator, "Global", r.value, r.headline, r.observedAt, r.confidencePct)


# source id -> (record model, mapper, mapping version)
ADAPTERS: dict[str, tuple[type[BaseModel], Callable, str]] = {
    "src-policy": (PolicyRecord, _policy, "sim-policy v1"),
    "src-logistics": (LogisticsRecord, _logistics, "sim-logistics v1"),
    "src-price": (PriceRecord, _price, "sim-price v1"),
}


def normalise(source_id: str, record: dict) -> Normalized:
    model, mapper, _ = ADAPTERS[source_id]
    try:
        return mapper(model.model_validate(record))
    except ValidationError as exc:
        err = exc.errors()[0]
        field = str(err["loc"][0]) if err["loc"] else WHOLE_RECORD
        bad = "" if err["type"] == "missing" else json.dumps(err.get("input"), default=str)[:200]
        if err["type"] == "missing":
            raise RecordRejected(f"Missing required field: {field}", field) from None
        raise RecordRejected(f"{field} is not valid: {err['msg']}", field, bad) from None


def canonical_country(session: Session, text: str) -> str:
    """The country's canonical name from its name or alias, or the record is rejected."""
    wanted = text.strip().lower()
    for name, in session.execute(select(Country.name)):
        if name.lower() == wanted:
            return name
    row = session.execute(select(Country.name).join(CountryAlias, CountryAlias.country_code == Country.code).where(func.lower(CountryAlias.alias) == wanted)).first()
    if row:
        return row[0]
    raise RecordRejected(f"Unresolved location: {text!r} is not a known country or alias", "country", text)


def _quarantine(session: Session, ing: Ingestion, index: int, rej: RecordRejected, record_json: str) -> None:
    session.add(QuarantineItem(
        id=next_id(session, QuarantineItem.id, "Q-", 4), source_id=ing.source_id, run_id=ing.id, received_at=clock.now(),
        reason=rej.reason, source_row=f"record {index} of {ing.object_key.rsplit('/', 1)[-1]}", object_key=ing.object_key,
        field=rej.field, bad_value=rej.bad_value, status="quarantined", ingestion_id=ing.id, record_json=record_json,
    ))
    session.flush()


def process_record(session: Session, ing: Ingestion, record: object, index: int, *, reject: Literal["quarantine", "raise"] = "quarantine") -> str:
    """Process one record. Returns accepted, duplicate or quarantined.

    With reject="raise" (used by replay) a rejection propagates instead of creating a new quarantine item.
    """
    text = record if isinstance(record, str) else json.dumps(record, sort_keys=True)
    try:
        if not isinstance(record, dict):
            raise RecordRejected("Record is not a JSON object")
        n = normalise(ing.source_id, record)
        country = n.country if n.country == "Global" else canonical_country(session, n.country)
    except RecordRejected as rej:
        if reject == "raise":
            raise
        _quarantine(session, ing, index, rej, text)
        return "quarantined"

    digest = sha256(json.dumps(record, sort_keys=True).encode())
    prior = session.scalars(select(Observation).where(Observation.source_id == ing.source_id, Observation.record_id == n.record_id)).first()
    if prior is not None:
        if prior.record_sha256 == digest:
            return "duplicate"
        rej = RecordRejected("Record ID already received with different content; needs review", "recordId", n.record_id)
        if reject == "raise":
            raise rej
        _quarantine(session, ing, index, rej, text)
        return "quarantined"

    newest = session.scalar(
        select(func.max(Observation.published_at)).where(Observation.source_id == ing.source_id, Observation.country == country, Observation.kind == n.kind)
    )
    obs = Observation(
        id=next_id(session, Observation.id, "OB-", 6), ingestion_id=ing.id, source_id=ing.source_id, record_id=n.record_id,
        record_sha256=digest, commodity=n.commodity, kind=n.kind, event_type=n.event_type, country=country, value=n.value,
        headline=n.headline, published_at=n.published_at, confidence_pct=n.confidence_pct, mode=ing.mode,
        scenario_run=ing.scenario_run, mapping_version=ADAPTERS[ing.source_id][2], ingested_at=clock.now(), outcome="late",
    )
    session.add(obs)
    session.flush()
    if newest is not None and n.published_at < newest:
        return "accepted"  # kept as history: a late record never overwrites or re-raises the current picture
    alerting.evaluate(session, obs, ing.evidence_id)
    return "accepted"


def process_raw(session: Session, env: RawObjectEnvelope) -> None:
    """Process a collected object. Safe to run twice: a processed ingestion is skipped."""
    ing = session.get(Ingestion, env.ingestion_id, with_for_update=True)
    if ing is None:
        raise PermanentError(f"Unknown ingestion {env.ingestion_id}")
    if ing.status == "processed":
        return
    if env.source_id not in ADAPTERS:
        raise PermanentError(f"No mapping is configured for source {env.source_id}")
    body = get_store().get(env.object_key)  # a missing object is retried: storage may recover
    if sha256(body) != env.sha256:
        raise PermanentError("Checksum mismatch: the stored object differs from what was collected")

    counts = {"accepted": 0, "duplicate": 0, "quarantined": 0}
    try:
        payload = json.loads(body)
    except ValueError:
        _quarantine(session, ing, 1, RecordRejected("Payload is not valid JSON", WHOLE_RECORD, body.decode(errors="replace")[:200]), body.decode(errors="replace"))
        counts["quarantined"] += 1
        records: list = []
    else:
        if isinstance(payload, dict) and "records" in payload:
            if payload.get("schemaVersion", SUPPORTED_SCHEMA) != SUPPORTED_SCHEMA:
                raise PermanentError(f"Schema version {payload['schemaVersion']} not supported (mapping v{SUPPORTED_SCHEMA} only)")
            records = payload["records"] if isinstance(payload["records"], list) else [payload["records"]]
        else:
            records = payload if isinstance(payload, list) else [payload]
    for i, record in enumerate(records, start=1):
        counts[process_record(session, ing, record, i)] += 1

    now = clock.now()
    ing.status, ing.records, ing.mapping_version = "processed", len(records) or counts["quarantined"], ADAPTERS[env.source_id][2]
    source = session.get(Source, env.source_id)
    if counts["accepted"]:
        source.last_usable, source.last_error = now, None
    status = "ok" if not counts["quarantined"] else ("failed" if not counts["accepted"] and not counts["duplicate"] else "partial")
    add_run(session, env.source_id, status, counts["accepted"], counts["duplicate"], counts["quarantined"], f"{ing.id} ({ing.mapping_version})")


def process_replay(session: Session, quarantine_id: str, actor: str) -> str:
    """Apply a steward's correction to a quarantined record and run it through the same pipeline."""
    q = session.get(QuarantineItem, quarantine_id, with_for_update=True)
    if q is None or q.status != "replay_requested":
        return "skipped"
    try:
        if not q.record_json or not q.ingestion_id:
            raise RecordRejected("The original record was not retained for this item, so it cannot be replayed", q.field, q.bad_value)
        if q.field == WHOLE_RECORD:
            try:
                record = json.loads(q.correction or "")
            except ValueError:
                raise RecordRejected("The corrected value is not valid JSON", WHOLE_RECORD, q.correction or "") from None
        else:
            record = json.loads(q.record_json)
            record[q.field] = q.correction
        ing = session.get(Ingestion, q.ingestion_id)
        outcome = process_record(session, ing, record, 1, reject="raise")
    except RecordRejected as rej:
        q.status, q.reason, q.field, q.bad_value, q.correction = "quarantined", f"Replay failed: {rej.reason}", rej.field, rej.bad_value, None
        audit.record(session, actor, "quarantine.replay_failed", q.id, rej.reason)
        return "failed"
    q.status = "resolved"
    add_run(session, q.source_id, "ok", 1 if outcome == "accepted" else 0, 1 if outcome == "duplicate" else 0, 0, f"Replay of {q.id}")
    audit.record(session, actor, "quarantine.replayed", q.id, outcome)
    return outcome
