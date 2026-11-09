"""Simulator scenarios and the effects of injected failures.

Scenario events are scheduled in virtual hours from START and emitted as provider-shaped payloads
through the same collection stage a live source would use, so they follow the real pipeline:
evidence, outbox, worker, validation, rules. The same scenario and seed give the same events.
Everything is labelled simulated. Records are stamped with the real clock, the run log with virtual time.
"""

import json
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, clock
from .collect import add_run, collect
from .models import Ingestion, SimLog, SimRun, Source
from .storage import get_store

START = datetime(2026, 11, 7, 8, 0, tzinfo=UTC)

SOURCE_FOR_KIND = {"policy": "src-policy", "logistics": "src-logistics", "price": "src-price"}
TIME_FIELD = {"policy": "announcedAt", "logistics": "reportedAt", "price": "observedAt"}


@dataclass(frozen=True)
class Event:
    at: int
    kind: str  # policy, logistics, price
    text: str
    fields: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Scenario:
    id: str
    name: str
    commodity: str
    seed: int
    events: tuple[Event, ...]


SCENARIOS_FILE = Path(__file__).resolve().parent.parent / "seed" / "scenarios.json"


def load_scenarios(path: Path = SCENARIOS_FILE) -> dict[str, Scenario]:
    """Scenarios are data, not code: seed/scenarios.json, or any file in the same format."""
    raw = json.loads(path.read_text())["scenarios"]
    return {
        r["id"]: Scenario(
            r["id"], r["name"], r["commodity"], r["seed"],
            tuple(Event(e["at"], e["kind"], e["text"], e.get("fields", {})) for e in r["events"]),
        )
        for r in raw
    }


SCENARIOS: dict[str, Scenario] = load_scenarios()

FAILURES = ("rate_limit", "timeout", "recover", "duplicate", "late", "malformed", "missing_field")
MAX_ADVANCE_HOURS = 168


def virtual_now(run: SimRun) -> datetime:
    return START + timedelta(hours=run.offset_hours)


def active_run(session: Session) -> SimRun | None:
    return session.scalars(select(SimRun).where(SimRun.active_slot.is_not(None))).first()


def label(run: SimRun) -> str:
    return f"{run.scenario_id} / {run.id}"


def _log(session: Session, run: SimRun, text: str, hours: int | None = None) -> None:
    session.add(SimLog(run_id=run.id, at=START + timedelta(hours=run.offset_hours if hours is None else hours), text=text))


def _payload(run: SimRun, record_id: str, kind: str, fields: dict, hours: int) -> bytes:
    record = {"recordId": record_id, **fields, TIME_FIELD[kind]: (START + timedelta(hours=hours)).isoformat().replace("+00:00", "Z")}
    return json.dumps({"schemaVersion": 1, "records": [record]}, sort_keys=True).encode()


def _emit(session: Session, run: SimRun, event: Event, index: int) -> None:
    body = _payload(run, f"{run.id}-e{index}", event.kind, event.fields, event.at)
    collect(session, SOURCE_FOR_KIND[event.kind], body, mode="simulated", scenario_run=label(run), published_at=START + timedelta(hours=event.at))
    _log(session, run, event.text, event.at)


def start(session: Session, scenario: Scenario, actor_name: str) -> SimRun:
    n = session.query(SimRun).count() + 1
    run = SimRun(
        id=f"run-{scenario.seed:04d}-{n:03d}", scenario_id=scenario.id, seed=scenario.seed, status="running",
        active_slot=1, offset_hours=0, emitted=0, started_at=clock.now(), started_by=actor_name,
    )
    session.add(run)
    session.flush()
    for i, e in enumerate(scenario.events, start=1):
        if e.at == 0:
            _emit(session, run, e, i)
            run.emitted += 1
    audit.record(session, actor_name, "simulator.started", run.id, scenario.name)
    return run


def advance(session: Session, run: SimRun, hours: int, actor_name: str) -> list[Event]:
    scenario = SCENARIOS[run.scenario_id]
    due = [(i, e) for i, e in enumerate(scenario.events, start=1) if run.offset_hours < e.at <= run.offset_hours + hours]
    run.offset_hours += hours
    for i, e in due:
        _emit(session, run, e, i)
    if not due:
        _log(session, run, f"Clock advanced {hours} h, no scheduled events")
    run.emitted += len(due)
    audit.record(session, actor_name, "simulator.advanced", run.id, f"{hours} h, {len(due)} event(s)")
    return [e for _, e in due]


def end(session: Session, run: SimRun, actor_name: str) -> None:
    run.status, run.active_slot, run.ended_at = "ended", None, clock.now()
    audit.record(session, actor_name, "simulator.reset", run.id, "run ended; decisions and actions untouched")


def inject(session: Session, run: SimRun, kind: str, actor_name: str) -> str:
    """Apply a failure and log it. Returns the log line.

    Failures that carry a payload (malformed, missing field, duplicate, late) go through collection
    and are handled by the worker like any real delivery.
    """
    now = clock.now()
    scenario = SCENARIOS[run.scenario_id]
    first_policy = next(e for e in scenario.events if e.kind == "policy")
    n = session.query(SimLog).filter(SimLog.run_id == run.id).count() + 1

    if kind == "rate_limit":
        text = "Injected HTTP 429 with retry hint 30 s; collection retried after backoff"
        add_run(session, "src-policy", "ok", 0, 0, 0, "HTTP 429, retried after backoff")
    elif kind == "timeout":
        text = "Injected source timeout; logistics feed marked failing, last usable data kept"
        src = session.get(Source, "src-logistics")
        src.last_attempt, src.last_error = now, "Timeout after 30 s"
        add_run(session, "src-logistics", "failed", 0, 0, 0, "Timeout after 30 s")
    elif kind == "recover":
        text = "Source recovered; logistics feed collected again"
        src = session.get(Source, "src-logistics")
        src.last_attempt, src.last_usable, src.last_error = now, now, None
        add_run(session, "src-logistics", "ok", 0, 0, 0, "Collection resumed after outage")
    elif kind == "duplicate":
        text = "Injected duplicate delivery; the same payload received twice, one alert only"
        last = session.scalars(select(Ingestion).where(Ingestion.scenario_run == label(run)).order_by(Ingestion.id.desc())).first()
        collect(session, last.source_id, get_store().get(last.object_key), mode="simulated", scenario_run=label(run))
    elif kind == "late":
        text = "Injected out-of-order observation; kept as history, current value not overwritten"
        body = _payload(run, f"{run.id}-late-{n}", "policy", first_policy.fields, -24)
        collect(session, "src-policy", body, mode="simulated", scenario_run=label(run), published_at=START - timedelta(hours=24))
    elif kind == "malformed":
        text = "Injected malformed payload; record sent to quarantine by the worker"
        collect(session, "src-policy", b'{"schemaVersion": 1, "records": [{"recordId": "', mode="simulated", scenario_run=label(run))
    elif kind == "missing_field":
        text = "Injected record with a missing required field; record sent to quarantine by the worker"
        fields = {k: v for k, v in first_policy.fields.items() if k != "country"}
        collect(session, "src-policy", _payload(run, f"{run.id}-bad-{n}", "policy", fields, run.offset_hours), mode="simulated", scenario_run=label(run))
    else:
        raise ValueError(kind)
    _log(session, run, text)
    audit.record(session, actor_name, "simulator.inject", run.id, kind)
    return text
