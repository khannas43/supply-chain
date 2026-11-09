from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import network
from .. import scope
from ..auth import Actor, maybe_actor
from ..deps import get_session
from ..models import Node
from ..schemas import Commodity, Direction, EdgeOut, NodeOut, TraverseNodeOut, TraverseOut

router = APIRouter(prefix="/api/network", tags=["network"])


@router.get("/nodes", response_model=list[NodeOut])
def list_nodes(
    commodity: Commodity | None = None,
    session: Session = Depends(get_session),
    actor: Actor | None = Depends(maybe_actor),
) -> list[NodeOut]:
    query = select(Node).order_by(Node.commodity, Node.name)
    if (visible := scope.clause(actor, Node.commodity)) is not None:
        query = query.where(visible)
    if commodity:
        query = query.where(Node.commodity == commodity)
    return [NodeOut.model_validate(n) for n in session.scalars(query)]


@router.get("/traverse", response_model=TraverseOut)
def traverse(
    focus: str,
    direction: Direction = "both",
    depth: int = Query(3, ge=1, le=network.MAX_DEPTH),
    material: str | None = Query(None, max_length=100),
    limit: int = Query(25, ge=1, le=100),
    session: Session = Depends(get_session),
    actor: Actor | None = Depends(maybe_actor),
) -> TraverseOut:
    """Suppliers upstream and/or downstream of a node, bounded by depth and result limit.

    Links that return to a node already on the path are reported in cycleEdgeIds and not followed.
    """
    node = session.get(Node, focus)
    if node is None or not scope.allowed(actor, node.commodity):
        raise HTTPException(404, f"Node {focus} not found")
    try:
        result = network.traverse(session, focus, direction, depth, material, limit)
    except KeyError:
        raise HTTPException(404, f"Node {focus} not found") from None
    return TraverseOut(
        focus=focus, direction=direction, depth=depth, limit=limit,
        total_reachable=result.total_reachable, truncated=result.truncated,
        nodes=[TraverseNodeOut(node=NodeOut.model_validate(n), level=lvl) for n, lvl in result.nodes],
        edges=[EdgeOut.model_validate(e) for e in result.edges],
        cycle_edge_ids=result.cycle_edge_ids,
    )
