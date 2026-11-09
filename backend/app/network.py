"""Supplier network traversal in PostgreSQL.

Upstream follows links against their direction, downstream follows them. Each walk is a
recursive query with a depth bound and a path guard: a link that returns to a node already
on the current path is recorded as a cycle link and not followed.
"""

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

from .models import Node, SupplyEdge

MAX_DEPTH = 5

_WALK = """
WITH RECURSIVE walk(node_id, depth, path, edge_id, is_cycle) AS (
    SELECT CAST(n.id AS text), 0, ARRAY[CAST(n.id AS text)], CAST(NULL AS text), false
    FROM node n WHERE n.id = :focus
  UNION ALL
    SELECT CAST(e.{to_col} AS text), w.depth + 1, w.path || CAST(e.{to_col} AS text), CAST(e.id AS text),
           CAST(e.{to_col} AS text) = ANY (w.path)
    FROM walk w
    JOIN supply_edge e ON e.{from_col} = w.node_id
    WHERE w.depth < :depth
      AND NOT w.is_cycle
      AND e.effective_from <= :as_of
      AND (e.effective_to IS NULL OR e.effective_to >= :as_of)
      AND (CAST(:material AS text) IS NULL OR e.material ILIKE '%' || CAST(:material AS text) || '%')
)
SELECT node_id, depth, edge_id, is_cycle FROM walk
"""

# (column followed from, column arrived at)
_STEPS = {"downstream": ("from_node", "to_node"), "upstream": ("to_node", "from_node")}


@dataclass
class Traversal:
    nodes: list[tuple[Node, int]]
    edges: list[SupplyEdge]
    total_reachable: int
    truncated: bool
    cycle_edge_ids: list[str] = field(default_factory=list)


def traverse(
    session: Session,
    focus: str,
    direction: str,
    depth: int,
    material: str | None = None,
    limit: int = 25,
    as_of: date | None = None,
) -> Traversal:
    """Raises KeyError when the focus node does not exist."""
    if session.get(Node, focus) is None:
        raise KeyError(focus)
    depth = max(1, min(depth, MAX_DEPTH))
    params = {"focus": focus, "depth": depth, "as_of": as_of or date.today(), "material": material or None}

    level: dict[str, int] = {focus: 0}
    edge_ids: set[str] = set()
    cycles: set[str] = set()
    for name in ("upstream", "downstream"):
        if direction not in (name, "both"):
            continue
        sign = -1 if name == "upstream" else 1
        from_col, to_col = _STEPS[name]
        for node_id, d, edge_id, is_cycle in session.execute(text(_WALK.format(from_col=from_col, to_col=to_col)), params):
            if edge_id is not None:
                edge_ids.add(edge_id)
                if is_cycle:
                    cycles.add(edge_id)
            if is_cycle or d == 0:
                continue
            # keep the shortest distance; on a tie the upstream side wins (it is walked first)
            if node_id not in level or d < abs(level[node_id]):
                level[node_id] = sign * d

    ordered = sorted(level.items(), key=lambda kv: (abs(kv[1]), kv[1], kv[0]))
    kept = ordered[:limit]
    kept_ids = {node_id for node_id, _ in kept}
    by_id = {n.id: n for n in session.query(Node).filter(Node.id.in_(kept_ids))}
    edges = (
        session.query(SupplyEdge)
        .filter(SupplyEdge.id.in_(edge_ids), SupplyEdge.from_node.in_(kept_ids), SupplyEdge.to_node.in_(kept_ids))
        .order_by(SupplyEdge.id)
        .all()
    )
    return Traversal(
        nodes=[(by_id[node_id], lvl) for node_id, lvl in kept],
        edges=edges,
        total_reachable=len(ordered),
        truncated=len(ordered) > limit,
        cycle_edge_ids=sorted(cycles),
    )
