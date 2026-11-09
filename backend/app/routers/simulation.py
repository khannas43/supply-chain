from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import audit, simulator
from ..auth import Actor, require_role
from ..deps import get_session
from ..models import SimLog, SimRun
from ..schemas import AdvanceIn, InjectIn, ScenarioOut, SimEventOut, SimLogOut, SimStateOut, StartIn

router = APIRouter(prefix="/api/simulator", tags=["simulator"])
operator = require_role("admin", "demo_operator")


def _state(session: Session) -> SimStateOut:
    run = simulator.active_run(session)
    if run is None:
        return SimStateOut(status="idle", virtual_now=simulator.START)
    log = session.scalars(select(SimLog).where(SimLog.run_id == run.id).order_by(SimLog.id))
    return SimStateOut(
        status=run.status, scenario_id=run.scenario_id, run_id=run.id, seed=run.seed, offset_hours=run.offset_hours,
        virtual_now=simulator.virtual_now(run), emitted=run.emitted, total_events=len(simulator.SCENARIOS[run.scenario_id].events),
        log=[SimLogOut(at=x.at, run_id=run.id, text=x.text) for x in log],
    )


def _running(session: Session) -> SimRun:
    run = simulator.active_run(session)
    if run is None:
        raise HTTPException(409, "No simulator run is active. Start one first")
    if run.status != "running":
        raise HTTPException(409, "The run is paused. Resume it first")
    return run


@router.get("/scenarios", response_model=list[ScenarioOut])
def scenarios() -> list[ScenarioOut]:
    return [
        ScenarioOut(id=s.id, name=s.name, commodity=s.commodity, seed=s.seed, events=[SimEventOut(at=e.at, text=e.text) for e in s.events])
        for s in simulator.SCENARIOS.values()
    ]


@router.get("/run", response_model=SimStateOut)
def current_run(session: Session = Depends(get_session)) -> SimStateOut:
    return _state(session)


@router.post("/runs", response_model=SimStateOut, status_code=201)
def start_run(body: StartIn, actor: Actor = Depends(operator), session: Session = Depends(get_session)) -> SimStateOut:
    scenario = simulator.SCENARIOS.get(body.scenario_id)
    if scenario is None:
        raise HTTPException(422, f"Unknown scenario: {body.scenario_id}")
    if simulator.active_run(session) is not None:
        raise HTTPException(409, "A run is already active. Reset it before starting another")
    try:
        simulator.start(session, scenario, actor.name)
        session.commit()
    except IntegrityError:
        session.rollback()
        raise HTTPException(409, "A run is already active. Reset it before starting another") from None
    return _state(session)


@router.post("/run/pause", response_model=SimStateOut)
def pause(actor: Actor = Depends(operator), session: Session = Depends(get_session)) -> SimStateOut:
    run = _running(session)
    run.status = "paused"
    audit.record(session, actor.name, "simulator.paused", run.id)
    session.commit()
    return _state(session)


@router.post("/run/resume", response_model=SimStateOut)
def resume(actor: Actor = Depends(operator), session: Session = Depends(get_session)) -> SimStateOut:
    run = simulator.active_run(session)
    if run is None or run.status != "paused":
        raise HTTPException(409, "There is no paused run to resume")
    run.status = "running"
    audit.record(session, actor.name, "simulator.resumed", run.id)
    session.commit()
    return _state(session)


@router.post("/run/advance", response_model=SimStateOut)
def advance(body: AdvanceIn, actor: Actor = Depends(operator), session: Session = Depends(get_session)) -> SimStateOut:
    run = _running(session)
    simulator.advance(session, run, body.hours, actor.name)
    session.commit()
    return _state(session)


@router.post("/run/inject", response_model=SimStateOut)
def inject(body: InjectIn, actor: Actor = Depends(operator), session: Session = Depends(get_session)) -> SimStateOut:
    run = _running(session)
    simulator.inject(session, run, body.kind, actor.name)
    session.commit()
    return _state(session)


@router.post("/run/reset", response_model=SimStateOut)
def reset(actor: Actor = Depends(operator), session: Session = Depends(get_session)) -> SimStateOut:
    """End the run. Decisions, actions and assessments are never touched."""
    run = simulator.active_run(session)
    if run is None:
        raise HTTPException(409, "No simulator run is active")
    simulator.end(session, run, actor.name)
    session.commit()
    return _state(session)
