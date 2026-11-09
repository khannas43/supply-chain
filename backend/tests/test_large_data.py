"""The large-data generator: deterministic, loadable, and the loaded network works."""

import json
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import network, seed

sys.path.insert(0, str(Path(seed.SEED_FILE).parent))
import generate_large  # noqa: E402


@pytest.fixture(scope="module")
def generated():
    base = json.loads(seed.SEED_FILE.read_text())
    return generate_large.generate(base, nodes_per_commodity=40, n_alerts=12, seed=3), base


def test_the_same_arguments_give_the_same_data(generated):
    again = generate_large.generate(generated[1], nodes_per_commodity=40, n_alerts=12, seed=3)
    assert json.dumps(again, sort_keys=True) == json.dumps(generated[0], sort_keys=True)
    other = generate_large.generate(generated[1], nodes_per_commodity=40, n_alerts=12, seed=4)
    assert json.dumps(other, sort_keys=True) != json.dumps(generated[0], sort_keys=True)


def test_it_loads_next_to_the_demo_data_and_adds_to_it(engine, generated, tmp_path):
    data, base = generated
    path = tmp_path / "large.json"
    path.write_text(json.dumps(data))
    seed.load(engine, path=path)
    with engine.connect() as c:
        count = lambda sql: c.execute(text(sql)).scalar_one()
        assert count("SELECT count(*) FROM node") > len(base["node"]) + 80
        assert count("SELECT count(*) FROM alert") == len(base["alert"]) + 12
        assert count("SELECT count(*) FROM node WHERE id LIKE 'wl-%'") >= 40 and count("SELECT count(*) FROM node WHERE id LIKE 'tl-%'") >= 40
        # everything generated has a supplier or a customer, and no alert is left without its evidence
        assert count("SELECT count(*) FROM node n WHERE id LIKE '%l-%' AND NOT EXISTS (SELECT 1 FROM supply_edge e WHERE e.from_node = n.id OR e.to_node = n.id)") == 0
        assert count("SELECT count(*) FROM alert a WHERE NOT EXISTS (SELECT 1 FROM evidence e WHERE e.id = a.evidence_id)") == 0


def test_the_generated_network_can_be_traversed(engine, generated, tmp_path):
    data, _ = generated
    path = tmp_path / "large.json"
    path.write_text(json.dumps(data))
    seed.load(engine, path=path)
    with Session(engine) as s:
        for focus in ("wl-o0001", "tl-o0001"):
            r = network.traverse(s, focus, "downstream", 5, None, 100)
            assert r.total_reachable > 1
        r = network.traverse(s, "wl-g0001", "upstream", 5, None, 100)  # from a product back to its sources
        assert r.total_reachable > 1


def test_the_demo_data_is_untouched(generated):
    data, base = generated
    for table in ("node", "supply_edge", "alert", "action"):
        assert data[table][: len(base[table])] == base[table]
