"""Simulator scenarios and the effects of injected failures.

Scenario events are scheduled in virtual hours from START. The same scenario and seed give the
same events. Everything the simulator produces is labelled simulated. System records
(runs, quarantine, source state) are stamped with the real clock; the run log uses virtual time.
"""

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import audit, clock
from .ids import next_id
from .models import IngestionRun, QuarantineItem, SimLog, SimRun, Source

START = datetime(2026, 11, 7, 8, 0, tzinfo=UTC)


@dataclass(frozen=True)
class Event:
    at: int
    text: str


@dataclass(frozen=True)
class Scenario:
    id: str
    name: str
    commodity: str
    seed: int
    events: tuple[Event, ...]


SCENARIOS: dict[str, Scenario] = {
    s.id: s
    for s in (
        Scenario("SC-W-1", "Wheat policy and logistics event", "wheat", 4711, (
            Event(0, "Policy announcement: export restriction, Country A (simulated)"),
            Event(6, "Logistics report: port congestion, Country B corridor (simulated)"),
            Event(30, "Policy clarification published; scope unchanged (simulated)"),
        )),
        Scenario("SC-T-1", "Tungsten export-policy event", "tungsten", 1042, (
            Event(0, "Policy announcement: export licence tightening, Country T (simulated)"),
            Event(12, "Price series update: concentrate above threshold (simulated)"),
            Event(36, "Licence quota notice, Country T (simulated)"),
        )),
    )
}

FAILURES = ("rate_limit", "timeout", "recover", "duplicate", "late", "malformed", "missing_field")
MAX_ADVANCE_HOURS = 168


def virtual_now(run: SimRun) -> datetime:
    return START + timedelta(hours=run.offset_hours)


def active_run(session: Session) -> SimRun | None:
    return session.scalars(select(SimRun).where(SimRun.active_slot.is_not(None))).first()


def _log(session: Session, run: SimRun, text: str, hours: int | None = None) -> None:
    session.add(SimLog(run_id=run.id, at=START + timedelta(hours=run.offset_hours if hours is None else hours), text=text))


def _run_record(session: Session, source_id: str, status: str, accepted: int, duplicate: int, quarantined: int, note: str) -> None:
    session.add(IngestionRun(
        id=next_id(session, IngestionRun.id, "RUN-", 4), source_id=source_id, started_at=clock.now(), status=status,
        accepted=accepted, duplicate=duplicate, quarantined=quarantined, note=note,
    ))
    session.flush()


def start(session: Session, scenario: Scenario, actor_name: str) -> SimRun:
    n = session.query(SimRun).count() + 1
    run = SimRun(
        id=f"run-{scenario.seed:04d}-{n:03d}", scenario_id=scenario.id, seed=scenario.seed, status="running",
        active_slot=1, offset_hours=0, emitted=0, started_at=clock.now(), started_by=actor_name,
    )
    session.add(run)
    session.flush()
    first = [e for e in scenario.events if e.at == 0]
    for e in first:
        _log(session, run, e.text, 0)
    run.emitted = len(first)
    _run_record(session, "src-policy", "ok", len(first), 0, 0, f"Simulator {run.id}")
    audit.record(session, actor_name, "simulator.started", run.id, scenario.name)
    return run


def advance(session: Session, run: SimRun, hours: int, actor_name: str) -> list[Event]:
    scenario = SCENARIOS[run.scenario_id]
    due = [e for e in scenario.events if run.offset_hours < e.at <= run.offset_hours + hours]
    run.offset_hours += hours
    for e in due:
        _log(session, run, e.text, e.at)
    if not due:
        _log(session, run, f"Clock advanced {hours} h, no scheduled events")
    run.emitted += len(due)
    if due:
        _run_record(session, "src-policy", "ok", len(due), 0, 0, f"Simulator {run.id}")
    audit.record(session, actor_name, "simulator.advanced", run.id, f"{hours} h, {len(due)} event(s)")
    return due


def end(session: Session, run: SimRun, actor_name: str) -> None:
    run.status, run.active_slot, run.ended_at = "ended", None, clock.now()
    audit.record(session, actor_name, "simulator.reset", run.id, "run ended; decisions and actions untouched")


def inject(session: Session, run: SimRun, kind: str, actor_name: str) -> str:
    """Apply a failure to the pipeline records and log it. Returns the log line."""
    now = clock.now()

    def quarantine(reason: str, column: str, bad: str) -> None:
        session.add(QuarantineItem(
            id=next_id(session, QuarantineItem.id, "Q-", 4), source_id="src-policy", run_id=run.id, received_at=now,
            reason=reason, source_row=f"row 1 of injected-{run.id}.json", object_key=f"evidence/sim/{run.id}/injected.json",
            field=column, bad_value=bad, status="quarantined",
        ))
        session.flush()

    if kind == "rate_limit":
        text = "Injected HTTP 429 with retry hint 30 s; collection retried after backoff"
        _run_record(session, "src-policy", "ok", 0, 0, 0, "HTTP 429, retried after backoff")
    elif kind == "timeout":
        text = "Injected source timeout; logistics feed marked failing, last usable data kept"
        src = session.get(Source, "src-logistics")
        src.last_attempt, src.last_error = now, "Timeout after 30 s"
        _run_record(session, "src-logistics", "failed", 0, 0, 0, "Timeout after 30 s")
    elif kind == "recover":
        text = "Source recovered; logistics feed collected again"
        src = session.get(Source, "src-logistics")
        src.last_attempt, src.last_usable, src.last_error = now, now, None
        _run_record(session, "src-logistics", "ok", 4, 0, 0, "Recovered after outage")
    elif kind == "duplicate":
        text = "Injected duplicate delivery; same record received twice, one alert only"
        _run_record(session, "src-policy", "ok", 0, 1, 0, "Duplicate delivery ignored")
    elif kind == "late":
        text = "Injected out-of-order observation; kept as history, current value not overwritten"
        _run_record(session, "src-policy", "ok", 1, 0, 0, "Late record retained as history")
    elif kind == "malformed":
        text = "Injected malformed payload; record sent to quarantine"
        quarantine("Payload is not valid JSON", "(whole record)", '{"country": "A", ')
        _run_record(session, "src-policy", "partial", 0, 0, 1, "Malformed payload")
    elif kind == "missing_field":
        text = "Injected record with a missing required field; record sent to quarantine"
        quarantine("Missing required field: country", "country", "")
        _run_record(session, "src-policy", "partial", 0, 0, 1, "Missing required field")
    else:
        raise ValueError(kind)
    _log(session, run, text)
    audit.record(session, actor_name, "simulator.inject", run.id, kind)
    return text
