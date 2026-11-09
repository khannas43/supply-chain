"""Generates seed/demo-large.json: the demo data plus a large generated network, for testing at scale.

    docker compose run --rm --no-deps -u root -v "$PWD/backend:/srv" -w /srv api \
        python seed/generate_large.py --nodes 400 --alerts 200 [--seed 1] [--out seed/demo-large.json]
    docker compose exec api python -m app.seed --reset --file seed/demo-large.json

--nodes is per commodity. The same arguments always give the same file. The generated entities use their own
ids (wl-, tl-, AL-x-1001 and up) and never touch the hand-built demo set. Real country names, invented
companies and events, as in the demo set.
"""

import argparse
import json
import random
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from pathlib import Path

HERE = Path(__file__).parent
LAYERS = [("o", "origin", "Tier 4", 0.34), ("c", "supplier", "Tier 3", 0.30), ("r", "supplier", "Tier 2", 0.14),
          ("p", "supplier", "Tier 1", 0.10), ("f", "plant", None, 0.08), ("g", "product", None, 0.04)]
MATERIAL = {"wheat": ["wheat, milling grade", "wheat, milling grade", "flour input", "flour input", "flour"],
            "tungsten": ["tungsten ore", "tungsten concentrate", "APT (ammonium paratungstate)", "carbide powder", "carbide insert"]}
SEV = {1: "low", 2: "medium", 3: "high", 4: "critical"}
LABEL = {"export_restriction": "Export restriction announced", "export_licence": "Export licence tightening"}


def generate(base: dict, nodes_per_commodity: int, n_alerts: int, seed: int) -> dict:
    rng = random.Random(seed)
    anchor = datetime.fromisoformat(base["_meta"]["anchor"].replace("Z", "+00:00"))
    ts = lambda days=0, hours=0: (anchor + timedelta(days=days, hours=hours)).isoformat().replace("+00:00", "Z")
    day = lambda d: (anchor + timedelta(days=d)).date().isoformat()
    countries = [c["name"] for c in base["country"]]
    out = {k: list(v) if isinstance(v, list) else dict(v) for k, v in base.items()}
    rules = {r["name"]: next(v for v in base["rule_version"] if v["rule_id"] == r["id"] and v["status"] == "published") for r in base["rule"]}
    rule_id = {r["name"]: r["id"] for r in base["rule"]}

    nodes, edges, by_layer = [], [], {}
    out_adj = defaultdict(list)
    for commodity in ("wheat", "tungsten"):
        prefix = commodity[0] + "l"
        layer_ids = []
        for code, kind, tier, share in LAYERS:
            ids = [f"{prefix}-{code}{i:04d}" for i in range(1, max(2, round(nodes_per_commodity * share)) + 1)]
            layer_ids.append(ids)
            for i in ids:
                nodes.append(dict(id=i, commodity=commodity, name=f"{commodity.title()} {kind} {i[-5:]}", kind=kind, tier=tier,
                                  country=rng.choice(countries), site=None))
        by_layer[commodity] = layer_ids
        for k in range(len(layer_ids) - 1):
            targets, covered = layer_ids[k + 1], set()
            for a in layer_ids[k]:
                for b in rng.sample(targets, min(len(targets), rng.randint(1, 3))):
                    covered.add(b)
                    edges.append((a, b, k))
            for b in set(targets) - covered:  # nothing is left without a supplier
                edges.append((rng.choice(layer_ids[k]), b, k))
            if k + 2 < len(layer_ids) and rng.random() < 0.9:
                for _ in range(max(1, len(layer_ids[k]) // 20)):  # a few links that skip a tier
                    edges.append((rng.choice(layer_ids[k]), rng.choice(layer_ids[k + 2]), k))
        for tier_ids in layer_ids[1:4]:  # a few loops between peers
            for _ in range(max(1, len(tier_ids) // 40)):
                a, b = rng.sample(tier_ids, 2)
                edges += [(a, b, 1), (b, a, 1)]
    seen, rows = set(), []
    for a, b, k in edges:
        if a == b or (a, b) in seen:
            continue
        seen.add((a, b))
        commodity = "wheat" if a.startswith("wl") else "tungsten"
        conf = rng.choices(["high", "medium", "low"], [5, 4, 1])[0]
        rows.append(dict(id=f"el{len(rows) + 1}", from_node=a, to_node=b, material=MATERIAL[commodity][min(k, 4)], source="Generated supplier file",
                         confidence=conf, effective_from=day(-rng.randint(200, 1500)), effective_to=None, uncertain=conf == "low", note=None))
        out_adj[a].append(b)
    out["node"] += nodes
    out["supply_edge"] += rows
    country_of = {n["id"]: n["country"] for n in nodes}
    commodity_of = {n["id"]: n["commodity"] for n in nodes}

    def downstream(origin, depth=5, cap=120):
        level, queue = {origin: 0}, deque([origin])
        while queue and len(level) < cap:
            n = queue.popleft()
            if level[n] < depth:
                for m in out_adj[n]:
                    if m not in level:
                        level[m] = level[n] + 1
                        queue.append(m)
        return [k for k, _ in sorted(level.items(), key=lambda kv: (kv[1], kv[0]))]

    def exposed(commodity, country):
        found = []
        for origin in sorted(i for i in by_layer[commodity][0] if country_of[i] == country)[:8]:
            found += [n for n in downstream(origin) if n not in found]
        return found[:150]

    n = defaultdict(int)
    nxt = lambda prefix, width: (n.__setitem__(prefix, n[prefix] + 1) or f"{prefix}{n[prefix]:0{width}d}")
    start = {"ING-": 10000, "OB-": 100000, "EV-": 0, "O-W-": 1000, "O-T-": 1000, "AS-W-": 1000, "AS-T-": 1000, "AC-W-": 1000, "AC-T-": 1000}
    for k, v in start.items():
        n[k] = v
    for i in range(1, n_alerts + 1):
        commodity = rng.choice(["wheat", "tungsten"])
        kind = rng.choice(["policy", "policy", "logistics"]) if commodity == "wheat" else rng.choice(["policy", "policy", "price"])
        rule = {("policy", "wheat"): "wheat-export-policy", ("policy", "tungsten"): "tungsten-export-policy",
                ("logistics", "wheat"): "wheat-logistics", ("price", "tungsten"): "tungsten-price"}[(kind, commodity)]
        thr = {t["key"]: t["value"] for t in rules[rule]["thresholds"]}
        country = "Global" if kind == "price" else rng.choice(sorted({country_of[i] for i in by_layer[commodity][0]}))
        pct = rng.randint(int(thr.get("conf", 50)), 95)
        value = round(rng.uniform(thr["delay"], thr["delay"] + 6), 0) if kind == "logistics" else round(rng.uniform(thr["chg"], thr["chg"] + 15), 1) if kind == "price" else None
        published = ts(-rng.randint(0, 30), hours=rng.randint(0, 20))
        ing, mode = nxt("ING-", 5), rng.choice(["simulated", "simulated", "replay"])
        digest = sha256(f"{seed}-{ing}".encode()).hexdigest()
        src = {"policy": "src-policy", "logistics": "src-logistics", "price": "src-price"}[kind]
        key = f"evidence/{mode}/{src}/generated/{ing}-{digest[:12]}.json"
        run = f"generated / run-{i:04d}"
        out["evidence"].append(dict(id=f"EV-{ing}", source=next(s["name"] for s in base["source"] if s["id"] == src), object_key=key, sha256=digest,
                                    published_at=published, ingested_at=published, mode=mode, scenario_run=run))
        out["ingestion"].append(dict(id=ing, source_id=src, received_at=published, evidence_id=f"EV-{ing}", object_key=key, sha256=digest, mode=mode,
                                     scenario_run=run, status="processed", records=1, mapping_version="generated", error=None))
        if kind == "policy":
            gate = f"confidence {pct}% >= floor {thr['conf']}%"
        elif kind == "logistics":
            gate = f"delay {value:g} days >= threshold {thr['delay']} days"
        else:
            gate = f"30-day change {value}% >= threshold {thr['chg']}%"
        event = {"policy": "export_restriction" if commodity == "wheat" else "export_licence", "logistics": "port_delay", "price": "price_change_30d_pct"}[kind]
        title = {"policy": f"{LABEL[event] if kind == 'policy' else ''}, {country}", "logistics": f"Port congestion, {country}", "price": f"Price spike: {value}% over 30 days"}[kind]
        aid = f"AL-{commodity[0].upper()}-{1000 + i}"
        nodes_hit = exposed(commodity, country)
        disposition = rng.choices(["new", "confirmed", "monitor", "dismissed"], [5, 2, 2, 1])[0]
        out["alert"].append(dict(id=aid, commodity=commodity, title=title, summary="Generated hazard evidence; not a confirmed interruption.", location=country,
                                 severity=SEV[int(thr["sev"])], confidence="high" if pct >= 80 else "medium" if pct >= 50 else "low", observed_at=published,
                                 mode=mode, scenario_run=run, assessment_status="partial" if nodes_hit else "unassessed", disposition=disposition,
                                 rule_id=rule_id[rule], rule_v=rules[rule]["v"], rule_inputs=[f"{kind} = {event}", f"country = {country}", f"commodity = {commodity}", gate],
                                 evidence_id=f"EV-{ing}"))
        out["observation"].append(dict(id=nxt("OB-", 6), ingestion_id=ing, source_id=src, record_id=f"gen-{i}", record_sha256=digest, commodity=commodity, kind=kind,
                                       event_type=event, country=country, value=value, headline=title, published_at=published, confidence_pct=pct, mode=mode,
                                       scenario_run=run, mapping_version="generated", ingested_at=published, outcome="alert_raised", alert_id=aid))
        out["alert_exposed_node"] += [dict(alert_id=aid, node_id=x, position=p) for p, x in enumerate(nodes_hit)]
        if nodes_hit and rng.random() < 0.35:  # assessed: options, an assumption, a snapshot, sometimes an action
            c = commodity[0].upper()
            opts = []
            for j in range(rng.randint(3, 5)):
                oid = nxt(f"O-{c}-", 4)
                opts.append(oid)
                out["response_option"].append(dict(
                    id=oid, alert_id=aid, type="inventory" if j == 0 else "sourcing", name=f"Generated option {oid}", qualification=rng.choice(["qualified", "qualified", "unknown"]),
                    spec_fit=rng.choice(["meets", "meets", "partial"]), capacity="stated, not verified", unit_price=None if j == 0 else round(rng.uniform(250, 350) if commodity == "wheat" else rng.uniform(42000, 56000)),
                    quantity_available=300 if j == 0 else None, lead_time_days=rng.randint(2, 70), quote_valid_until=None if j == 0 else day(rng.randint(-5, 60)), note=""))
            asm = nxt(f"AS-{c}-", 4)
            approved = rng.random() < 0.6
            out["assumption"].append(dict(id=asm, alert_id=aid, affected_share_pct=rng.randint(20, 90), basis="Generated assumption", proposed_by_id="u-analyst-a",
                                          proposed_by_name="Risk Analyst A", proposed_at=published, status="approved" if approved else "proposed",
                                          decided_by_id="u-analyst-b" if approved else None, decided_by_name="Risk Analyst B" if approved else None,
                                          decided_at=published if approved else None, decision_note=None))
            inputs = dict(asOf=day(-1), usableStock=rng.randint(500, 4000) if commodity == "wheat" else rng.randint(5, 20), stockUnit="t" if commodity == "wheat" else "t WO3 eq.",
                          demandPerDay=rng.randint(40, 150) if commodity == "wheat" else round(rng.uniform(0.1, 0.3), 2), baselinePrice=270 if commodity == "wheat" else 41500,
                          currency="USD", priceUnit="per t", notes=["Generated"])
            for v in ([1, 2] if approved else [1]):
                out["assessment"].append(dict(alert_id=aid, version=v, created_at=published, note="Generated", calc_version="impact-calc 0.3", assumption_id=asm if v == 2 else None,
                                              exposed_value=rng.randint(500, 6000) if commodity == "wheat" else rng.randint(5, 30), exposed_unit=inputs["stockUnit"],
                                              exposed_horizon="60 days", reference_option_id=opts[1], inputs=inputs, paths=[], missing=["Freight not included"]))
            if approved and rng.random() < 0.7:
                act = nxt(f"AC-{c}-", 4)
                status = rng.choice(["open", "in_progress", "review", "done"])
                out["action"].append(dict(id=act, alert_id=aid, commodity=commodity, option_id=opts[1], owner_id=rng.choice(["u-manager", "u-analyst-a", "u-analyst-b"]),
                                          owner_name="Generated owner", target_date=day(rng.randint(-10, 30)), rationale="Generated decision", status=status,
                                          created_at=published, created_by="Procurement Manager", assessment_version=2, assumption_status="approved"))
                out["action_status_history"].append(dict(action_id=act, at=published, actor="Procurement Manager", from_status=None, to_status="open", note="Decision recorded"))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--nodes", type=int, default=400, help="generated nodes per commodity")
    ap.add_argument("--alerts", type=int, default=200)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--base", default=str(HERE / "demo.json"))
    ap.add_argument("--out", default=str(HERE / "demo-large.json"))
    a = ap.parse_args()
    data = generate(json.loads(Path(a.base).read_text()), a.nodes, a.alerts, a.seed)
    Path(a.out).write_text(json.dumps(data, sort_keys=False, separators=(",", ":")) + "\n")
    print(f"wrote {a.out}: {len(data['node'])} nodes, {len(data['supply_edge'])} edges, {len(data['alert'])} alerts, "
          f"{len(data['alert_exposed_node'])} exposed-node rows, {len(data['action'])} actions")


if __name__ == "__main__":
    main()
