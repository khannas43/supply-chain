import pytest
from sqlalchemy.orm import Session

from app import network


def run(engine, focus, direction="both", depth=3, material=None, limit=25):
    with Session(engine) as s:
        r = network.traverse(s, focus, direction, depth, material, limit)
        return {
            "levels": {n.id: lvl for n, lvl in r.nodes},
            "edges": sorted(e.id for e in r.edges),
            "total": r.total_reachable,
            "truncated": r.truncated,
            "cycles": r.cycle_edge_ids,
        }


def test_wheat_both_directions_with_cycle(seeded):
    r = run(seeded, "w-milly")
    assert r["levels"] == {"w-milly": 0, "w-supx": -1, "w-traderq": -1, "w-supw": -2, "w-plantz": 1, "w-prodp": 2}
    assert r["cycles"] == ["e3", "e4"]  # Mill Y <-> Trader Q, detected and not followed
    assert r["total"] == 6 and not r["truncated"]


def test_downstream_depth_one_stops_before_the_cycle_closes(seeded):
    r = run(seeded, "w-milly", "downstream", 1)
    assert r["levels"] == {"w-milly": 0, "w-traderq": 1, "w-plantz": 1}
    assert r["cycles"] == []


def test_downstream_depth_two_detects_the_cycle(seeded):
    assert run(seeded, "w-milly", "downstream", 2)["cycles"] == ["e3"]


def test_upstream_only(seeded):
    r = run(seeded, "t-carbide", "upstream")
    assert r["levels"] == {"t-carbide": 0, "t-conc": -1, "t-apt": -1, "t-minem": -2, "t-minen": -2}
    assert r["cycles"] == []
    assert r["edges"] == ["e10", "e11", "e7", "e8", "e9"]


def test_material_filter(seeded):
    r = run(seeded, "t-carbide", "upstream", material="concentrate")
    assert r["levels"] == {"t-carbide": 0, "t-conc": -1}


def test_result_limit_is_reported(seeded):
    r = run(seeded, "w-milly", limit=3)
    assert len(r["levels"]) == 3
    assert r["total"] == 6 and r["truncated"]
    assert set(r["levels"]) == {"w-milly", "w-supx", "w-traderq"}  # nearest first
    assert all(e in {"e1", "e3", "e4"} for e in r["edges"])  # only links between kept nodes


def test_depth_bounds_the_walk(seeded):
    assert set(run(seeded, "w-milly", "upstream", 1)["levels"]) == {"w-milly", "w-supx", "w-traderq"}


def test_unknown_focus(seeded):
    with Session(seeded) as s, pytest.raises(KeyError):
        network.traverse(s, "nope", "both", 3)


def test_expired_links_are_not_followed(seeded):
    from sqlalchemy import text

    with seeded.begin() as c:
        c.execute(text("UPDATE supply_edge SET effective_to = '2025-01-01' WHERE id = 'e5'"))
    assert "w-plantz" not in run(seeded, "w-milly", "downstream")["levels"]
