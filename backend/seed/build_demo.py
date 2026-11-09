"""Builds seed/demo.json: the demo data set, authored here in readable Python.

    docker compose run --rm --no-deps -u root -v "$PWD/backend:/srv" -w /srv api python seed/build_demo.py

Real geography, fictional companies, synthetic events. Every country is real; every company, plant, price,
volume and event is invented, and every event is labelled simulated or replay. Nothing here describes
a real policy, shipment or supplier.

All dates are written relative to ANCHOR and moved at load time (see app/seed.py), so the demo is always
recent: some sources are fresh and one is stale, some quotes are about to expire and one has, some
actions are overdue, and so on, whenever it is loaded.

The sha256 values and exposure lists are computed here, not typed, so the data is internally consistent.
"""

import json
from collections import defaultdict, deque
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from pathlib import Path

ANCHOR = datetime(2026, 11, 9, 9, 0, tzinfo=UTC)
OUT = Path(__file__).with_name("demo.json")


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


def ts(days: float = 0, hours: float = 0, minutes: float = 0) -> str:
    return iso(ANCHOR + timedelta(days=days, hours=hours, minutes=minutes))


def day(days: int) -> str:
    return (ANCHOR + timedelta(days=days)).date().isoformat()


def canonical(body) -> bytes:
    return json.dumps(body, sort_keys=True).encode()


T: dict[str, list] = defaultdict(list)  # table name -> rows, in the order they are added
EVIDENCE: dict[str, dict] = {}

# ------------------------------------------------------------------------------------------------
# People, countries, reference data
# ------------------------------------------------------------------------------------------------

IDENTITIES = [  # mirrors frontend/src/auth/users.ts and keycloak/supplychain-realm.json
    ("u-viewer", "Executive Viewer", "viewer"),
    ("u-analyst-a", "Risk Analyst A", "analyst"),
    ("u-analyst-b", "Risk Analyst B", "analyst"),
    ("u-manager", "Procurement Manager", "manager"),
    ("u-steward", "Data Steward", "steward"),
    ("u-admin", "Platform Admin", "admin"),
    ("u-demo", "Demo Operator", "demo_operator"),
    ("u-analyst-wheat", "Wheat Analyst", "analyst"),
    ("u-analyst-tungsten", "Tungsten Analyst", "analyst"),
]
NAME = {i: n for i, n, _ in IDENTITIES}
for i, n, r in IDENTITIES:
    T["person"].append(dict(id=i, name=n, roles=[r], source="demo", last_seen=None))

COUNTRIES = [
    ("RUS", "Russia", ["RU", "Russian Federation"]), ("UKR", "Ukraine", ["UA"]), ("KAZ", "Kazakhstan", ["KZ"]),
    ("ROU", "Romania", ["RO"]), ("AUS", "Australia", ["AU"]), ("CAN", "Canada", ["CA"]), ("FRA", "France", ["FR"]),
    ("DEU", "Germany", ["DE", "Deutschland"]), ("USA", "United States", ["US", "USA", "United States of America"]),
    ("ARG", "Argentina", ["AR"]), ("NLD", "Netherlands", ["NL", "Holland"]), ("TUR", "Türkiye", ["TR", "Turkey", "Turkiye"]),
    ("ITA", "Italy", ["IT"]), ("CHN", "China", ["CN", "PRC", "People's Republic of China"]), ("VNM", "Vietnam", ["VN", "Viet Nam"]),
    ("KOR", "South Korea", ["KR", "Republic of Korea"]), ("PRT", "Portugal", ["PT"]), ("AUT", "Austria", ["AT"]),
    ("BOL", "Bolivia", ["BO"]), ("RWA", "Rwanda", ["RW"]), ("GBR", "United Kingdom", ["GB", "UK", "Great Britain"]),
    ("SWE", "Sweden", ["SE"]),
]
for code, name, aliases in COUNTRIES:
    T["country"].append(dict(code=code, name=name))
for code, name, aliases in COUNTRIES:
    for a in aliases:
        T["country_alias"].append(dict(alias=a, country_code=code))

FORMS = [
    ("wheat", "Milling grade", "Bread-making wheat to contract protein and moisture specification"),
    ("wheat", "Durum", "For semolina and pasta; not interchangeable with milling grade"),
    ("wheat", "Feed grade", "Not accepted for food plants"),
    ("tungsten", "Concentrate (65% WO3)", "Basis for WO3-equivalent conversion"),
    ("tungsten", "APT", "Ammonium paratungstate, the main intermediate"),
    ("tungsten", "Tungsten oxide", "Blue or yellow oxide, feed for carbide powder"),
    ("tungsten", "Carbide powder", "Carbide-grade; qualified suppliers only"),
    ("tungsten", "Scrap (recycled)", "Needs specification review before use"),
]
for c, f, n in FORMS:
    T["commodity_form"].append(dict(commodity=c, form=f, note=n))

CONVERSIONS = [
    ("t", "kg", 1000, -2000, "SI"), ("short ton", "t", 0.907185, -2000, "Approved unit table v2"),
    ("bushel (wheat, 60 lb)", "t", 0.0272155, -2000, "Approved unit table v2"),
    ("mtu WO3", "kg WO3", 10, -2000, "Industry convention: 1 mtu = 10 kg WO3"),
    ("USD", "EUR", 0.93, -40, "Approved rate table v3 (synthetic)"), ("USD", "EUR", 0.91, -3, "Approved rate table v4 (synthetic)"),
    ("EUR", "GBP", 0.86, -40, "Approved rate table v3 (synthetic)"),
]
for i, (a, b, f, d, s) in enumerate(CONVERSIONS, 1):
    T["unit_conversion"].append(dict(id=f"CV-{i}", from_unit=a, to_unit=b, factor=f, effective_from=day(d), source=s))

# ------------------------------------------------------------------------------------------------
# Sources
# ------------------------------------------------------------------------------------------------

SOURCES = [  # id, name, mode, commodities, last_attempt, last_usable, policy_hours
    ("src-policy", "Policy feed (simulator)", "simulated", ["wheat", "tungsten"], ts(hours=-1), ts(hours=-14), 48),
    ("src-logistics", "Logistics feed (simulator)", "simulated", ["wheat"], ts(hours=-1), ts(hours=-31), 12),  # stale on purpose
    ("src-price", "Price series (replay)", "replay", ["tungsten"], ts(hours=-1), ts(hours=-9), 24),
    ("src-import", "Manual file imports", "simulated", ["wheat", "tungsten"], ts(days=-3), ts(days=-3), 168),
]
SOURCE_NAME = {s[0]: s[1] for s in SOURCES}
for sid, name, mode, coms, att, use, pol in SOURCES:
    T["source"].append(dict(id=sid, name=name, mode=mode, enabled=True, last_attempt=att, last_usable=use, policy_hours=pol, last_error=None))
    for c in coms:
        T["source_commodity"].append(dict(source_id=sid, commodity=c))

# ------------------------------------------------------------------------------------------------
# Risk rules (the published version is what the worker applies)
# ------------------------------------------------------------------------------------------------


def th(**kw):
    labels = {
        "conf": ("Confidence floor to raise an alert", "%"), "sev": ("Severity score (1 low to 4 critical)", "score"),
        "stale": ("Stale after", "hours"), "delay": ("Port delay threshold", "days"), "chg": ("30-day price change", "%"),
    }
    return [dict(key=k, label=labels[k][0], value=v, unit=labels[k][1]) for k, v in kw.items()]


RULES = [
    ("R-W-EXP", "wheat-export-policy", "wheat", [
        ("1.0", "superseded", th(conf=60, sev=2, stale=24), -60, "Risk Analyst A", -60, "Risk Analyst A"),
        ("1.1", "superseded", th(conf=55, sev=3, stale=24), -35, "Risk Analyst A", -35, "Risk Analyst B"),
        ("1.2", "published", th(conf=50, sev=3, stale=48), -12, "Risk Analyst A", -12, "Risk Analyst B")]),
    ("R-W-LOG", "wheat-logistics", "wheat", [
        ("1.0", "published", th(delay=3, sev=2, stale=12), -45, "Risk Analyst A", -45, "Risk Analyst A"),
        ("1.1", "draft", th(delay=4, sev=2, stale=12), -2, "Risk Analyst A", None, None)]),
    ("R-T-EXP", "tungsten-export-policy", "tungsten", [
        ("1.0", "superseded", th(conf=70, sev=4, stale=24), -50, "Risk Analyst B", -50, "Risk Analyst B"),
        ("1.1", "published", th(conf=60, sev=4, stale=48), -20, "Risk Analyst B", -20, "Risk Analyst A")]),
    ("R-T-PRC", "tungsten-price", "tungsten", [
        ("1.0", "published", th(chg=15, sev=1, stale=24), -45, "Risk Analyst B", -45, "Risk Analyst A")]),
]
RULE_PUBLISHED = {}
for rid, name, com, versions in RULES:
    T["rule"].append(dict(id=rid, name=name, commodity=com))
    for v, status, thr, cd, cby, pd, pby in versions:
        T["rule_version"].append(dict(rule_id=rid, v=v, status=status, thresholds=thr, created_by=cby, created_at=ts(cd),
                                      published_by=pby, published_at=ts(pd, hours=1) if pd is not None else None))
        if status == "published":
            RULE_PUBLISHED[name] = (rid, v, {t["key"]: t["value"] for t in thr})

# ------------------------------------------------------------------------------------------------
# Supplier networks. Companies, plants and products are fictional; countries are real.
# ------------------------------------------------------------------------------------------------

NODES: dict[str, dict] = {}


def node(id_, com, name, kind, country, site=None, tier=None):
    NODES[id_] = dict(id=id_, commodity=com, name=name, kind=kind, tier=tier, country=country, site=site)


# wheat: origins (Tier 4), exporters and terminals (Tier 3), blenders and millers (Tier 1), plants, products
for i, n, c, s in [
    ("w-kuban", "Kuban Grain Cooperative", "Russia", "Krasnodar Krai"), ("w-volga", "Volga Steppe Farms", "Russia", "Saratov Oblast"),
    ("w-poltava", "Poltava Harvest Group", "Ukraine", "Poltava Oblast"), ("w-odagro", "Odesa Agro Holdings", "Ukraine", "Odesa Oblast"),
    ("w-akmola", "Akmola Wheat Producers", "Kazakhstan", "Akmola Region"), ("w-dobro", "Dobrogea Agri Trade", "Romania", "Constanța County"),
    ("w-wimmera", "Wimmera Growers Alliance", "Australia", "Victoria"), ("w-eyre", "Eyre Peninsula Grain Co-op", "Australia", "South Australia"),
    ("w-prairie", "Prairie Gold Cooperative", "Canada", "Saskatchewan"), ("w-beauce", "Beauce Céréales Union", "France", "Centre-Val de Loire"),
    ("w-borde", "Magdeburger Börde Landhandel", "Germany", "Saxony-Anhalt"), ("w-plains", "Great Plains Elevator Network", "United States", "Kansas"),
    ("w-pampa", "Pampa Cereales SA", "Argentina", "Buenos Aires Province"),
]:
    node(i, "wheat", n, "origin", c, s, "Tier 4")
for i, n, c, s in [
    ("w-novoross", "Novoross Grain Terminal", "Russia", "Novorossiysk"), ("w-azov", "Azov Export Services", "Russia", "Rostov-on-Don"),
    ("w-odterm", "Black Sea Maritime Grain", "Ukraine", "Odesa"), ("w-constanta", "Constanta Cereal Terminal", "Romania", "Constanța"),
    ("w-astana", "Astana Trade Link", "Kazakhstan", "Astana"), ("w-adelaide", "Southern Cross Grain Exports", "Australia", "Port Adelaide"),
    ("w-thunder", "Great Lakes Commodities", "Canada", "Thunder Bay"), ("w-rouen", "Rouen Port Grain", "France", "Rouen"),
    ("w-hamburg", "Hamburg Getreide Handel", "Germany", "Hamburg"), ("w-houston", "Gulf Coast Exporters", "United States", "Houston"),
    ("w-rosario", "Rosario Export Terminal", "Argentina", "Rosario"),
]:
    node(i, "wheat", n, "supplier", c, s, "Tier 3")
for i, n, c, s in [
    ("w-rott", "Rotterdam Flour Blenders", "Netherlands", "Rotterdam"), ("w-istanbul", "Istanbul Unlu Milling", "Türkiye", "Istanbul"),
    ("w-hmv", "Hamburg Mühlen Verbund", "Germany", "Hamburg"), ("w-marseille", "Marseille Semoulerie", "France", "Marseille"),
]:
    node(i, "wheat", n, "supplier", c, s, "Tier 1")
for i, n, c, s in [
    ("w-p-duisburg", "Plant Duisburg (bakery flour)", "Germany", "Duisburg"), ("w-p-lyon", "Plant Lyon (pasta)", "France", "Lyon"),
    ("w-p-milan", "Plant Milan (pasta)", "Italy", "Milan"), ("w-p-izmir", "Plant Izmir (biscuits)", "Türkiye", "Izmir"),
    ("w-p-rott", "Plant Rotterdam (bakery premix)", "Netherlands", "Rotterdam"),
]:
    node(i, "wheat", n, "plant", c, s)
for i, n, c in [
    ("w-prod-flour", "Bread flour (retail)", "Germany"), ("w-prod-pasta", "Durum pasta", "Italy"),
    ("w-prod-biscuit", "Biscuit dough", "Türkiye"), ("w-prod-premix", "Bakery premix", "Netherlands"),
]:
    node(i, "wheat", n, "product", c)

# tungsten: mines (Tier 4), concentrators and traders (Tier 3), refiners (Tier 2), powder makers (Tier 1), plants, products
for i, n, c, s in [
    ("t-ganzhou", "Ganzhou Highland Mining", "China", "Jiangxi"), ("t-xiushui", "Xiushui Tungsten Works", "China", "Jiangxi"),
    ("t-chenzhou", "Chenzhou Polymetallic Mining", "China", "Hunan"), ("t-primorsky", "Primorsky Wolfram Mining", "Russia", "Primorsky Krai"),
    ("t-thainguyen", "Thai Nguyen Tungsten Mining", "Vietnam", "Thai Nguyen Province"), ("t-gangwon", "Gangwon Tungsten Project", "South Korea", "Gangwon Province"),
    ("t-beira", "Beira Wolfram Mines", "Portugal", "Castelo Branco"), ("t-alpine", "Alpine Wolfram Mining", "Austria", "Salzburg"),
    ("t-yukon", "Yukon Scheelite Mine", "Canada", "Yukon"), ("t-qld", "Queensland Scheelite Holdings", "Australia", "Queensland"),
    ("t-potosi", "Potosí Wolframite Co-operative", "Bolivia", "Potosí"), ("t-rutsiro", "Rutsiro Wolframite Co-operative", "Rwanda", "Western Province"),
]:
    node(i, "tungsten", n, "origin", c, s, "Tier 4")
for i, n, c, s in [
    ("t-ganconc", "Ganzhou Concentrate Processing", "China", "Ganzhou"), ("t-chenconc", "Chenzhou Beneficiation Plant", "China", "Chenzhou"),
    ("t-vnconc", "Vietnam Wolfram Beneficiation", "Vietnam", "Thai Nguyen"), ("t-kigali", "Kigali Mineral Trading", "Rwanda", "Kigali"),
    ("t-lapaz", "La Paz Mineral Exports", "Bolivia", "La Paz"), ("t-rottmet", "Rotterdam Metals Trading", "Netherlands", "Rotterdam"),
    ("t-hamroh", "Hamburg Rohstoffhandel", "Germany", "Hamburg"),
]:
    node(i, "tungsten", n, "supplier", c, s, "Tier 3")
for i, n, c, s in [
    ("t-jxapt", "Jiangxi APT Refining", "China", "Ganzhou"), ("t-hnox", "Hunan Oxide Works", "China", "Chenzhou"),
    ("t-vnapt", "Vietnam APT Refinery", "Vietnam", "Thai Nguyen"), ("t-goslar", "Goslar Tungstenchemie", "Germany", "Goslar"),
    ("t-lisbon", "Lisbon Tungsten Chemicals", "Portugal", "Lisbon"), ("t-korea", "Korea Oxide Refinery", "South Korea", "Incheon"),
    ("t-pitt", "Allegheny Oxide Company", "United States", "Pittsburgh"),
]:
    node(i, "tungsten", n, "supplier", c, s, "Tier 2")
for i, n, c, s in [
    ("t-rhein", "Rhein Carbide Powders", "Germany", "Duisburg"), ("t-sheff", "Sheffield Hardmetal Powders", "United Kingdom", "Sheffield"),
    ("t-goth", "Gothenburg Carbide Works", "Sweden", "Gothenburg"), ("t-saar", "Saarland Hartstoff", "Germany", "Saarbrücken"),
]:
    node(i, "tungsten", n, "supplier", c, s, "Tier 1")
for i, n, c, s in [
    ("t-p-essen", "Plant Essen (cutting tools)", "Germany", "Essen"), ("t-p-sheffield", "Plant Sheffield (mining tools)", "United Kingdom", "Sheffield"),
    ("t-p-graz", "Plant Graz (inserts)", "Austria", "Graz"), ("t-p-goth", "Plant Gothenburg (wear parts)", "Sweden", "Gothenburg"),
]:
    node(i, "tungsten", n, "plant", c, s)
for i, n, c in [
    ("t-prod-insert", "Carbide cutting insert", "Germany"), ("t-prod-bit", "Mining drill bit", "United Kingdom"),
    ("t-prod-wear", "Wear part", "Sweden"), ("t-prod-roll", "Rolling tool", "Germany"),
]:
    node(i, "tungsten", n, "product", c)

H, M, L = "high", "medium", "low"
SRC = "Curated supplier file v1"
EDGES: list[dict] = []


def edge(a, b, material, conf, years_ago=2.0, note=None, uncertain=False, source=SRC):
    EDGES.append(dict(id=f"e{len(EDGES) + 1}", from_node=a, to_node=b, material=material, source=source, confidence=conf,
                      effective_from=day(-int(365 * years_ago)), effective_to=None, uncertain=uncertain, note=note))


WM, WD = "wheat, milling grade", "durum wheat"
# wheat: origin -> exporter or terminal
for a, b, m, c in [
    ("w-kuban", "w-novoross", WM, H), ("w-kuban", "w-azov", WM, M), ("w-volga", "w-azov", WM, M), ("w-poltava", "w-odterm", WM, H),
    ("w-odagro", "w-odterm", WM, H), ("w-akmola", "w-astana", WM, M), ("w-dobro", "w-constanta", WM, H), ("w-wimmera", "w-adelaide", WM, H),
    ("w-eyre", "w-adelaide", WM, H), ("w-prairie", "w-thunder", WD, H), ("w-beauce", "w-rouen", WM, H), ("w-borde", "w-hamburg", WM, H),
    ("w-plains", "w-houston", WM, M), ("w-pampa", "w-rosario", WM, M),
]:
    edge(a, b, m, c)
edge("w-astana", "w-novoross", WM, L, 1.0, "Transit by Russian rail; routing not confirmed by the supplier", True)
# exporter or terminal -> Tier 1
for a, b, m, c in [
    ("w-novoross", "w-istanbul", WM, H), ("w-novoross", "w-rott", WM, M), ("w-azov", "w-istanbul", WM, M), ("w-odterm", "w-istanbul", WM, M),
    ("w-odterm", "w-rott", WM, M), ("w-constanta", "w-hmv", WM, M), ("w-adelaide", "w-istanbul", WM, M), ("w-thunder", "w-rott", WD, H),
    ("w-thunder", "w-marseille", WD, H), ("w-rouen", "w-rott", WM, H), ("w-rouen", "w-marseille", WM, H), ("w-rouen", "w-hmv", WM, H),
    ("w-hamburg", "w-hmv", WM, H), ("w-hamburg", "w-rott", WM, M), ("w-houston", "w-rott", WM, M), ("w-rosario", "w-istanbul", WM, M),
]:
    edge(a, b, m, c)
edge("w-constanta", "w-istanbul", WM, L, 0.5, "Spot cargoes only; no contract on file", True)
edge("w-adelaide", "w-rott", WM, L, 1.0, "Occasional cargoes; share not recorded", True)
edge("w-rott", "w-hamburg", "wheat, surplus transfer", L, 1.0, "Stock transfers between blenders; creates a loop with the Hamburg link")
# Tier 1 -> plants -> products
for a, b, m, c in [
    ("w-istanbul", "w-p-izmir", "flour input", H), ("w-istanbul", "w-p-milan", "flour input", M), ("w-rott", "w-p-rott", "flour input", H),
    ("w-rott", "w-p-duisburg", "flour input", M), ("w-rott", "w-p-lyon", "flour input", M), ("w-hmv", "w-p-duisburg", "flour input", H),
    ("w-hmv", "w-p-milan", "flour input", M), ("w-marseille", "w-p-lyon", "durum semolina", H), ("w-marseille", "w-p-milan", "durum semolina", H),
    ("w-p-duisburg", "w-prod-flour", "flour", H), ("w-p-duisburg", "w-prod-premix", "flour", M), ("w-p-lyon", "w-prod-pasta", "durum semolina", H),
    ("w-p-milan", "w-prod-pasta", "durum semolina", H), ("w-p-izmir", "w-prod-biscuit", "flour", H), ("w-p-izmir", "w-prod-flour", "flour", M),
    ("w-p-rott", "w-prod-premix", "flour", H), ("w-p-rott", "w-prod-flour", "flour", M),
]:
    edge(a, b, m, c, 3.0 if c == H else 2.0, source="Curated BOM v1" if a.startswith("w-p-") else SRC)

TC, TA, TO, TP = "tungsten concentrate", "APT (ammonium paratungstate)", "tungsten oxide", "carbide powder"
for a, b, m, c in [
    ("t-ganzhou", "t-ganconc", "tungsten ore", H), ("t-xiushui", "t-ganconc", "tungsten ore", H), ("t-chenzhou", "t-chenconc", "tungsten ore", H),
    ("t-thainguyen", "t-vnconc", "tungsten ore", H), ("t-rutsiro", "t-kigali", "tungsten ore", M), ("t-potosi", "t-lapaz", "tungsten ore", M),
    ("t-beira", "t-lisbon", TC, H), ("t-alpine", "t-goslar", TC, H), ("t-gangwon", "t-korea", TC, H), ("t-yukon", "t-rottmet", TC, M),
    ("t-qld", "t-rottmet", TC, M),
]:
    edge(a, b, m, c)
edge("t-primorsky", "t-ganconc", "tungsten ore", L, 1.0, "Cross-border shipments to China; volumes not confirmed", True)
for a, b, m, c in [
    ("t-ganconc", "t-jxapt", TC, H), ("t-chenconc", "t-hnox", TC, H), ("t-ganconc", "t-hnox", TC, M), ("t-vnconc", "t-vnapt", TC, H),
    ("t-kigali", "t-rottmet", TC, M), ("t-lapaz", "t-hamroh", TC, M), ("t-rottmet", "t-goslar", TC, H), ("t-rottmet", "t-lisbon", TC, M),
    ("t-hamroh", "t-goslar", TC, H), ("t-hamroh", "t-pitt", TC, M),
]:
    edge(a, b, m, c)
edge("t-vnconc", "t-jxapt", TC, L, 1.0, "Resale to Chinese refiners; contract not seen", True)
edge("t-rottmet", "t-hamroh", "tungsten concentrate, trade swap", L, 1.0, "Swaps between traders; creates a loop with the Rotterdam link")
edge("t-hamroh", "t-rottmet", "tungsten concentrate, trade swap", L, 1.0, "Swaps between traders; creates a loop with the Hamburg link")
for a, b, m, c in [
    ("t-jxapt", "t-rhein", TA, H), ("t-jxapt", "t-saar", TA, M), ("t-hnox", "t-sheff", TO, M), ("t-vnapt", "t-rhein", TA, M),
    ("t-goslar", "t-rhein", TA, H), ("t-goslar", "t-saar", TA, H), ("t-goslar", "t-goth", TA, M), ("t-lisbon", "t-sheff", TA, H),
    ("t-lisbon", "t-goth", TA, M), ("t-korea", "t-sheff", TO, M),
]:
    edge(a, b, m, c)
edge("t-hnox", "t-goth", TO, L, 1.0, "Single trial shipment recorded", True)
edge("t-pitt", "t-sheff", TO, L, 1.0, "Spot supply only", True)
for a, b, m, c in [
    ("t-rhein", "t-p-essen", TP, H), ("t-rhein", "t-p-graz", TP, H), ("t-saar", "t-p-essen", TP, H), ("t-saar", "t-p-graz", TP, M),
    ("t-sheff", "t-p-sheffield", TP, H), ("t-goth", "t-p-goth", TP, H), ("t-goth", "t-p-sheffield", TP, M),
    ("t-p-essen", "t-prod-insert", "carbide insert", H), ("t-p-essen", "t-prod-roll", "carbide roll", H), ("t-p-graz", "t-prod-insert", "carbide insert", H),
    ("t-p-sheffield", "t-prod-bit", "drill bit", H), ("t-p-sheffield", "t-prod-wear", "wear part", M), ("t-p-goth", "t-prod-wear", "wear part", H),
    ("t-p-goth", "t-prod-bit", "drill bit", M),
]:
    edge(a, b, m, c, 3.0, source="Curated BOM v1" if a.startswith("t-p-") else SRC)

T["node"] = list(NODES.values())
T["supply_edge"] = EDGES
OUTGOING: dict[str, list[dict]] = defaultdict(list)
for e in EDGES:
    OUTGOING[e["from_node"]].append(e)
RANK = {H: 3, M: 2, L: 1}


def downstream(origin: str, depth: int = 5):
    """(node id, level) reachable downstream, nearest first: the same walk the API does."""
    level, queue = {origin: 0}, deque([origin])
    while queue:
        n = queue.popleft()
        if level[n] >= depth:
            continue
        for e in OUTGOING[n]:
            if e["to_node"] not in level:
                level[e["to_node"]] = level[n] + 1
                queue.append(e["to_node"])
    return sorted(level.items(), key=lambda kv: (kv[1], kv[0]))


def exposed_nodes(commodity: str, country: str) -> list[str]:
    if country == "Global":
        return []
    ordered: list[str] = []
    for origin in sorted(n["id"] for n in NODES.values() if n["commodity"] == commodity and n["country"] == country):
        for node_id, _ in downstream(origin):
            if node_id not in ordered:
                ordered.append(node_id)
    return ordered


def exposure_paths(commodity: str, country: str, limit: int = 2) -> list[dict]:
    """Up to two paths from the event's country to a product, classed by their weakest link."""
    out, seen = [], set()
    for origin in sorted(n["id"] for n in NODES.values() if n["commodity"] == commodity and n["country"] == country):
        parent = {origin: None}
        queue = deque([origin])
        while queue:
            n = queue.popleft()
            for e in OUTGOING[n]:
                if e["to_node"] not in parent:
                    parent[e["to_node"]] = e
                    queue.append(e["to_node"])
        for target in sorted(k for k in parent if NODES[k]["kind"] == "product"):
            chain, k = [], target
            while parent[k] is not None:
                chain.append(parent[k])
                k = parent[k]["from_node"]
            chain.reverse()
            names = [f"{NODES[origin]['name']} ({country})"] + [NODES[e["to_node"]]["name"] for e in chain]
            key = tuple(names)
            if key in seen:
                continue
            seen.add(key)
            weakest = min((e["confidence"] for e in chain), key=RANK.get)
            cls = {H: "confirmed", M: "potential", L: "unknown"}[weakest]
            uncertain = [e for e in chain if e["uncertain"]]
            basis = f"Country match; weakest link confidence {weakest}" + (f". Uncertain link: {uncertain[0]['note']}" if uncertain else "")
            out.append(dict(nodes=names, classification=cls, basis=basis))
            if len(out) >= limit:
                return out
    return out


# ------------------------------------------------------------------------------------------------
# Alerts, evidence, ingestion and observations (the trace from an alert back to its source)
# ------------------------------------------------------------------------------------------------

SEV = {1: "low", 2: "medium", 3: "high", 4: "critical"}
RULE_FOR = {("policy", "wheat"): "wheat-export-policy", ("policy", "tungsten"): "tungsten-export-policy",
            ("logistics", "wheat"): "wheat-logistics", ("price", "tungsten"): "tungsten-price"}
SOURCE_FOR = {"policy": "src-policy", "logistics": "src-logistics", "price": "src-price"}
TIME_FIELD = {"policy": "announcedAt", "logistics": "reportedAt", "price": "observedAt"}
MAPPING = {"policy": "sim-policy v1", "logistics": "sim-logistics v1", "price": "sim-price v1"}
LABEL = {"export_restriction": "Export restriction announced", "export_ban": "Export restriction announced",
         "export_quota": "Export quota notice", "export_licence": "Export licence tightening"}

counters = defaultdict(int)


def nxt(prefix: str, width: int) -> str:
    counters[prefix] += 1
    return f"{prefix}{counters[prefix]:0{width}d}"


def conf_level(pct: int) -> str:
    return "high" if pct >= 80 else "medium" if pct >= 50 else "low"


def collect(kind, commodity, country, event_type, headline, conf, published, mode, run, value=None, record_id=None, extra=None, ok=True):
    """Store one sample payload as evidence with its ingestion; returns the pieces the alert and observation need."""
    src = SOURCE_FOR[kind]
    ing = nxt("ING-", 5)
    rid = record_id or f"{src}-{ing[-5:]}"
    rec = dict(recordId=rid, commodity=commodity, headline=headline, confidencePct=conf, **(extra or {}))
    if kind == "policy":
        rec.update(country=country, policyType=event_type)
    elif kind == "logistics":
        rec.update(country=country, eventType=event_type, delayDays=value)
    else:
        rec.update(indicator=event_type, value=value)
    rec[TIME_FIELD[kind]] = published
    for k in [k for k, v in rec.items() if v is None]:
        del rec[k]  # a payload with a field left out (used for quarantined samples)
    body = {"schemaVersion": 1, "records": [rec]}
    digest = sha256(canonical(body)).hexdigest()
    key = f"evidence/{mode}/{src}/{published[:10].replace('-', '')}/{ing}-{digest[:12]}.json"
    EVIDENCE[key] = body
    pub = datetime.fromisoformat(published.replace("Z", "+00:00"))
    got = iso(pub + timedelta(minutes=25))
    T["evidence"].append(dict(id=f"EV-{ing}", source=SOURCE_NAME[src], object_key=key, sha256=digest, published_at=published,
                              ingested_at=got, mode=mode, scenario_run=run))
    T["ingestion"].append(dict(id=ing, source_id=src, received_at=got, evidence_id=f"EV-{ing}", object_key=key, sha256=digest, mode=mode,
                               scenario_run=run, status="processed", records=1, mapping_version=MAPPING[kind], error=None))
    return dict(ing=ing, rec=rec, rec_sha=sha256(canonical(rec)).hexdigest(), key=key, got=got, src=src, kind=kind)


def observation(c, commodity, country, event_type, value, headline, published, conf, mode, run, outcome, alert_id):
    T["observation"].append(dict(
        id=nxt("OB-", 6), ingestion_id=c["ing"], source_id=c["src"], record_id=c["rec"]["recordId"], record_sha256=c["rec_sha"],
        commodity=commodity, kind=c["kind"], event_type=event_type, country=country, value=value, headline=headline,
        published_at=published, confidence_pct=conf, mode=mode, scenario_run=run, mapping_version=MAPPING[c["kind"]],
        ingested_at=c["got"], outcome=outcome, alert_id=alert_id))


ALERTS: dict[str, dict] = {}
AUDIT: list[dict] = []


def audit(at, actor, event, ref, detail=""):
    AUDIT.append(dict(at=at, actor=actor, event=event, ref=ref, detail=detail))


def alert(id_, kind, commodity, country, event_type, headline, conf, days_ago, mode, disposition, value=None, status="partial",
          hours=0, run=None):
    published = ts(-days_ago, hours=hours)
    run = run or ("history / run-0007" if mode == "replay" else f"SC-{commodity[0].upper()}-0 / run-{4700 + len(ALERTS)}")
    rule_name = RULE_FOR[(kind, commodity)]
    rid, rv, thr = RULE_PUBLISHED[rule_name]
    c = collect(kind, commodity, country, event_type, headline, conf, published, mode, run, value)
    if kind == "policy":
        gate = f"confidence {conf}% >= floor {thr['conf']}%"
        title = f"{LABEL[event_type]}, {country}"
        inputs = [f"policy = {event_type}", f"country = {country}", f"commodity = {commodity}", gate]
    elif kind == "logistics":
        gate = f"delay {value} days >= threshold {thr['delay']} days"
        title = f"Port congestion, {country}"
        inputs = [f"logistics = {event_type}", f"country = {country}", f"commodity = {commodity}", gate]
    else:
        gate = f"30-day change {value}% >= threshold {thr['chg']}%"
        title = f"Price spike: {value}% over 30 days"
        inputs = [f"price = {event_type}", "country = Global", f"commodity = {commodity}", gate]
    nodes = exposed_nodes(commodity, country)
    row = dict(id=id_, commodity=commodity, title=title, summary=f"{headline}. This is hazard evidence: it does not confirm an interruption or quantify lost supply.",
               location=country, severity=SEV[int(thr["sev"])], confidence=conf_level(conf), observed_at=published, mode=mode,
               scenario_run=run, assessment_status=status, disposition=disposition, rule_id=rid, rule_v=rv, rule_inputs=inputs,
               evidence_id=f"EV-{c['ing']}")
    T["alert"].append(row)
    observation(c, commodity, country, event_type, value, headline, published, conf, mode, run, "alert_raised", id_)
    for i, n in enumerate(nodes):
        T["alert_exposed_node"].append(dict(alert_id=id_, node_id=n, position=i))
    ALERTS[id_] = dict(row=row, country=country, commodity=commodity, published=published, nodes=nodes)
    audit(c["got"], "Ingestion worker", "alert.raised", id_, f"{rule_name} v{rv} from OB-{counters['OB-']:06d}")
    return c


# wheat
alert("AL-W-001", "policy", "wheat", "Russia", "export_restriction", "Export restriction announced on wheat, Russia", 65, 6, "simulated", "confirmed", status="complete")
alert("AL-W-002", "policy", "wheat", "Kazakhstan", "export_quota", "Export quota notice for wheat, Kazakhstan", 55, 3, "simulated", "new")
alert("AL-W-003", "logistics", "wheat", "Ukraine", "port_delay", "Port congestion at Odesa delays grain shipments", 45, 4, "simulated", "monitor", value=5)
alert("AL-W-004", "logistics", "wheat", "Russia", "port_delay", "Berth queue at Novorossiysk delays wheat loading", 60, 2, "simulated", "new", value=4)
alert("AL-W-005", "logistics", "wheat", "Argentina", "port_delay", "River draft restrictions slow barge traffic to Rosario", 35, 8, "simulated", "dismissed", value=3)
alert("AL-W-006", "policy", "wheat", "Argentina", "export_restriction", "Export restriction announced on wheat, Argentina", 70, 20, "replay", "confirmed", status="complete")
alert("AL-W-007", "logistics", "wheat", "Romania", "port_delay", "Congestion at Constanța delays wheat departures", 50, 1, "simulated", "new", value=6)
# tungsten
alert("AL-T-001", "policy", "tungsten", "China", "export_licence", "Export licence rules for tungsten products tightened, China", 88, 7, "simulated", "confirmed", status="complete")
alert("AL-T-002", "policy", "tungsten", "Russia", "export_restriction", "Export restriction announced on tungsten concentrate, Russia", 62, 5, "simulated", "new", status="awaiting_validation")
alert("AL-T-003", "policy", "tungsten", "Vietnam", "export_quota", "Export quota notice for tungsten, Vietnam", 71, 2, "simulated", "new")
alert("AL-T-004", "price", "tungsten", "Global", "price_change_30d_pct", "Tungsten concentrate price up 18.5% over 30 days", 75, 3, "replay", "monitor", value=18.5, status="unassessed")
alert("AL-T-005", "price", "tungsten", "Global", "price_change_30d_pct", "Tungsten APT price up 24% over 30 days", 80, 1, "simulated", "new", value=24, status="unassessed")
alert("AL-T-006", "policy", "tungsten", "Rwanda", "export_licence", "Export licence suspension for wolframite, Rwanda", 64, 30, "replay", "dismissed")

# observations that did not become alerts (what the rules decided, and why)
for kind, com, country, et, head, conf, d, mode, value, outcome, aid in [
    ("policy", "wheat", "Russia", "export_restriction", "Restriction on wheat exports reiterated, Russia", 68, 5, "simulated", None, "merged", "AL-W-001"),
    ("policy", "wheat", "Russia", "clarification", "Clarification published; scope of the restriction unchanged", 70, 4, "simulated", None, "no_rule_match", None),
    ("policy", "wheat", "Argentina", "export_restriction", "Draft export restriction under discussion, Argentina", 42, 9, "simulated", None, "below_threshold", None),
    ("logistics", "wheat", "Argentina", "port_delay", "Short delay at Rosario terminal", 40, 6, "simulated", 2, "below_threshold", None),
    ("policy", "tungsten", "China", "export_licence", "Earlier notice on licence tightening, China", 86, 8, "simulated", None, "late", None),
    ("policy", "tungsten", "China", "export_quota", "Export licence quota notice, China", 80, 6, "simulated", None, "merged", "AL-T-001"),
    ("price", "tungsten", "Global", "price_change_30d_pct", "Tungsten concentrate price up 9% over 30 days", 70, 12, "replay", 9, "below_threshold", None),
]:
    pub = ts(-d, hours=3)
    c = collect(kind, com, country, et, head, conf, pub, mode, ALERTS[aid]["row"]["scenario_run"] if aid else f"history / run-{4800 + counters['ING-']}", value)
    observation(c, com, country, et, value, head, pub, conf, mode, ALERTS[aid]["row"]["scenario_run"] if aid else f"history / run-{4800 + counters['ING-']}", outcome, aid)

# ------------------------------------------------------------------------------------------------
# Assessments, assumptions, response options
# ------------------------------------------------------------------------------------------------

OPTIONS: dict[str, dict] = {}
opt_counter = defaultdict(int)


def option(alert_id, otype, name, qual, spec, capacity, price, lead, valid_days, note, qty=None):
    com = ALERTS[alert_id]["commodity"]
    opt_counter[com] += 1
    oid = f"O-{com[0].upper()}-{opt_counter[com]:02d}"
    row = dict(id=oid, alert_id=alert_id, type=otype, name=name, qualification=qual, spec_fit=spec, capacity=capacity,
               unit_price=price, quantity_available=qty, lead_time_days=lead, quote_valid_until=day(valid_days) if valid_days is not None else None, note=note)
    OPTIONS[oid] = row
    T["response_option"].append(row)
    return oid


ASSUMPTIONS: dict[str, dict] = {}
VERSIONS: dict[str, list] = defaultdict(list)


def assumption(aid, alert_id, pct, basis, proposer, proposed_days, status, decider=None, decided_days=None, note=None):
    row = dict(id=aid, alert_id=alert_id, affected_share_pct=pct, basis=basis, proposed_by_id=proposer, proposed_by_name=NAME[proposer],
               proposed_at=ts(proposed_days), status=status, decided_by_id=decider, decided_by_name=NAME[decider] if decider else None,
               decided_at=ts(decided_days) if decided_days is not None else None, decision_note=note)
    ASSUMPTIONS[aid] = row
    T["assumption"].append(row)
    audit(row["proposed_at"], NAME[proposer], "assumption.proposed", aid, f"{pct}% affected share")
    if status in ("approved", "rejected"):
        audit(row["decided_at"], NAME[decider], f"assumption.{status}", aid, note or status)


def assessment(alert_id, version, days, note, assumption_id, exposed, inputs, ref_option, missing):
    a = ALERTS[alert_id]
    T["assessment"].append(dict(
        alert_id=alert_id, version=version, created_at=ts(days), note=note, calc_version="impact-calc 0.3", assumption_id=assumption_id,
        exposed_value=exposed[0], exposed_unit=exposed[1], exposed_horizon=exposed[2], reference_option_id=ref_option, inputs=inputs,
        paths=exposure_paths(a["commodity"], a["country"]), missing=missing))


def inputs(as_of_days, stock, unit, demand, price, price_unit, notes):
    return dict(asOf=day(as_of_days), usableStock=stock, stockUnit=unit, demandPerDay=demand, baselinePrice=price, currency="USD",
                priceUnit=price_unit, notes=notes)


W_NOTES = ["Usable stock only; reserved stock excluded", "Constant demand, no other receipts assumed"]
T_NOTES = ["Usable stock only; reserved stock excluded", "Constant demand, no other receipts assumed", "Quantities in WO3 equivalent"]
W_MISSING = ["Freight and other additional costs (not included in the cost figure)", "Share of each mill's volume sourced from the affected country (allocation unknown)"]
T_MISSING = ["Inbound receipts schedule not supplied (time-phased balance not possible)", "Freight, duties and licence fees not included in the cost figure"]
INITIAL = "Initial partial assessment: exposure and cover only"

# --- AL-W-001: Russia wheat export restriction (three versions, two successive assumptions) ---
o = {}
o["ref"] = option("AL-W-001", "sourcing", "French milling wheat via Rouen (Rouen Port Grain)", "qualified", "meets", "12,000 t / month (stated, not verified)", 318, 30, 25, "Qualified milling grade. Commercial terms not agreed.")
o["ca"] = option("AL-W-001", "sourcing", "Canadian milling wheat via Thunder Bay (Great Lakes Commodities)", "qualified", "meets", "8,000 t / month (stated, not verified)", 342, 38, 40, "Qualified; longest lead time.")
o["au"] = option("AL-W-001", "sourcing", "Australian milling wheat via Port Adelaide (Southern Cross Grain Exports)", "qualified", "meets", "10,000 t / month (stated, not verified)", 329, 45, 12, "Quote lapses soon; needs a decision this fortnight.")
o["ro"] = option("AL-W-001", "sourcing", "Romanian wheat via Constanța (Constanta Cereal Terminal)", "unknown", "partial", "6,000 t / month (stated, not verified)", 301, 18, 20, "Qualification not on file; protein specification only partly met.")
o["stock"] = option("AL-W-001", "inventory", "Transfer buffer stock from Plant Rotterdam", "qualified", "meets", "600 t available", None, 2, None, "Internal transfer. Handling cost not included.", qty=600)
o["rail"] = option("AL-W-001", "logistics", "Expedited rail from Beauce to Rouen", "qualified", "meets", "Route-limited", 309, 21, -6, "Quote has expired. Needs a fresh quote.")
assumption("AS-W-1", "AL-W-001", 80, "Restriction covers all exports from the Black Sea ports for the full horizon (analyst estimate, synthetic).", "u-analyst-a", -5.5, "superseded", "u-analyst-b", -5, "Accepted for the first assessment.")
assumption("AS-W-2", "AL-W-001", 70, "Clarification limits the restriction to bulk cargoes; 70% of contracted volume affected (synthetic).", "u-analyst-a", -3.5, "approved", "u-analyst-b", -3, "Agreed after the clarification.")
wi = inputs(-6, 2900, "t", 120, 285, "per t", W_NOTES)
assessment("AL-W-001", 1, -6, INITIAL, None, (5400, "t", "60 days"), wi, o["ref"], W_MISSING)
assessment("AL-W-001", 2, -5, "Assumption AS-W-1 approved (80% affected share)", "AS-W-1", (5400, "t", "60 days"), wi, o["ref"], W_MISSING)
assessment("AL-W-001", 3, -3, "Assumption AS-W-2 approved (70% affected share)", "AS-W-2", (5400, "t", "60 days"), wi, o["ref"], W_MISSING)

# --- AL-W-006: Argentina restriction, an older replayed case with a completed response ---
a1 = option("AL-W-006", "sourcing", "US hard red winter via Houston (Gulf Coast Exporters)", "qualified", "meets", "9,000 t / month (stated, not verified)", 291, 20, 9, "Used for the earlier response.")
a2 = option("AL-W-006", "inventory", "Draw down Lyon pasta-plant buffer", "qualified", "meets", "400 t available", None, 1, None, "Internal transfer.", qty=400)
a3 = option("AL-W-006", "sourcing", "French soft wheat via Rouen (Rouen Port Grain)", "qualified", "partial", "5,000 t / month (stated, not verified)", 284, 16, 15, "Soft wheat; specification only partly met for pasta.")
assumption("AS-W-3", "AL-W-006", 60, "Restriction applies to roughly 60% of contracted Argentine volume (synthetic).", "u-analyst-a", -19, "approved", "u-analyst-b", -18, "Reasonable for the case.")
wi = inputs(-20, 1500, "t", 60, 270, "per t", W_NOTES)
assessment("AL-W-006", 1, -20, INITIAL, None, (1800, "t", "45 days"), wi, a1, W_MISSING)
assessment("AL-W-006", 2, -18, "Assumption AS-W-3 approved (60% affected share)", "AS-W-3", (1800, "t", "45 days"), wi, a1, W_MISSING)

# --- AL-W-003: Ukraine port delay, assumption rejected ---
u1 = option("AL-W-003", "sourcing", "Romanian wheat via Constanța (qualified lot)", "qualified", "meets", "6,000 t / month (stated, not verified)", 296, 14, 18, "Qualified lot from the Dobrogea region.")
u2 = option("AL-W-003", "inventory", "Transfer stock from Plant Milan", "qualified", "meets", "300 t available", None, 3, None, "Internal transfer.", qty=300)
u3 = option("AL-W-003", "logistics", "Switch loading to a second Black Sea berth", "qualified", "meets", "Berth-limited", 289, 9, 4, "Depends on terminal availability; quote expires soon.")
assumption("AS-W-4", "AL-W-003", 30, "Short delay; part of the volume re-routed (synthetic).", "u-analyst-a", -3.5, "rejected", "u-analyst-b", -3, "Delay is short and Odesa holds stock buffers; no disruption assumption needed.")
wi = inputs(-4, 2400, "t", 90, 285, "per t", W_NOTES)
assessment("AL-W-003", 1, -4, INITIAL, None, (2100, "t", "30 days"), wi, u1, W_MISSING)

# --- AL-T-001: China tungsten export licence tightening (three versions) ---
t1 = option("AL-T-001", "sourcing", "Vietnamese APT via Vietnam APT Refinery", "qualified", "meets", "6 t / quarter (stated, not verified)", 49800, 75, 30, "Qualified for carbide-grade powder.")
t2 = option("AL-T-001", "sourcing", "European APT via Goslar Tungstenchemie", "qualified", "meets", "9 t / quarter (stated, not verified)", 52400, 55, 35, "Qualified; highest price.")
t3 = option("AL-T-001", "sourcing", "Portuguese concentrate with Lisbon refining (Beira, Lisbon Tungsten Chemicals)", "qualified", "meets", "4 t / quarter (stated, not verified)", 47900, 90, 50, "Lowest price, longest lead time.")
t4 = option("AL-T-001", "sourcing", "Recycled tungsten scrap blend (Allegheny Oxide Company)", "unknown", "partial", "3 t / quarter (stated, not verified)", 43500, 45, 60, "Specification only partly met; qualification pending.")
t5 = option("AL-T-001", "inventory", "Release strategic stock", "qualified", "meets", "3 t available", None, 2, None, "Reduces the buffer for other programmes; approval needed.", qty=3)
t6 = option("AL-T-001", "sourcing", "Spot purchase via Rotterdam Metals Trading", "qualified", "meets", "2 t (spot)", 56000, 28, 8, "Spot price; quote expires soon.")
assumption("AS-T-1", "AL-T-001", 55, "Licence tightening cuts Chinese exports of tungsten products by about 55% over the horizon (synthetic).", "u-analyst-a", -6.5, "superseded", "u-analyst-b", -6, "First estimate.")
assumption("AS-T-2", "AL-T-001", 65, "Quota notice confirms deeper cuts; 65% affected (synthetic).", "u-analyst-a", -4.5, "approved", "u-analyst-b", -4, "Agreed after the quota notice.")
ti = inputs(-7, 11, "t WO3 eq.", 0.16, 41500, "per t WO3 eq.", T_NOTES)
assessment("AL-T-001", 1, -7, INITIAL, None, (26, "t WO3 eq.", "180 days"), ti, t1, T_MISSING)
assessment("AL-T-001", 2, -6, "Assumption AS-T-1 approved (55% affected share)", "AS-T-1", (26, "t WO3 eq.", "180 days"), ti, t1, T_MISSING)
assessment("AL-T-001", 3, -4, "Assumption AS-T-2 approved (65% affected share)", "AS-T-2", (26, "t WO3 eq.", "180 days"), ti, t1, T_MISSING)

# --- AL-T-002: Russia tungsten restriction, assumption still waiting for approval ---
r1 = option("AL-T-002", "sourcing", "Vietnamese APT via Vietnam APT Refinery", "qualified", "meets", "6 t / quarter (stated, not verified)", 49800, 75, 30, "Qualified for carbide-grade powder.")
r2 = option("AL-T-002", "sourcing", "European APT via Goslar Tungstenchemie", "qualified", "meets", "9 t / quarter (stated, not verified)", 52400, 55, 35, "Qualified.")
r3 = option("AL-T-002", "inventory", "Release strategic stock", "qualified", "meets", "3 t available", None, 2, None, "Approval needed.", qty=3)
assumption("AS-T-3", "AL-T-002", 40, "Russian concentrate is a minor input; 40% of that volume affected (synthetic).", "u-analyst-a", -1, "proposed")
wi = inputs(-5, 11, "t WO3 eq.", 0.16, 41500, "per t WO3 eq.", T_NOTES)
assessment("AL-T-002", 1, -5, INITIAL, None, (8, "t WO3 eq.", "120 days"), wi, r1, T_MISSING)

for oid, who_, d in [(o["ref"], "u-analyst-a", -3), (t2, "u-manager", -2)]:
    T["option_shortlist"].append(dict(option_id=oid, shortlisted_by_id=who_, shortlisted_by_name=NAME[who_], shortlisted_at=ts(d)))

# ------------------------------------------------------------------------------------------------
# Actions: a mix of statuses, owners, dates; some overdue, some flagged because the assessment moved on
# ------------------------------------------------------------------------------------------------

ACTIONS = []


def action(id_, alert_id, opt, owner, target_days, status, version, assumption_status, rationale, created_days, history):
    a = ALERTS[alert_id]
    row = dict(id=id_, alert_id=alert_id, commodity=a["commodity"], option_id=opt, owner_id=owner, owner_name=NAME[owner],
               target_date=day(target_days), rationale=rationale, status=status, created_at=ts(created_days), created_by=NAME["u-manager"],
               assessment_version=version, assumption_status=assumption_status)
    T["action"].append(row)
    T["action_status_history"].append(dict(action_id=id_, at=ts(created_days), actor=NAME["u-manager"], from_status=None, to_status="open", note="Decision recorded"))
    audit(ts(created_days), NAME["u-manager"], "decision.created", id_, f"{OPTIONS[opt]['name']}, owner {NAME[owner]}")
    prev = "open"
    for d, who_, to, note in history:
        T["action_status_history"].append(dict(action_id=id_, at=ts(d), actor=NAME[who_], from_status=prev, to_status=to, note=note))
        audit(ts(d), NAME[who_], "action.status", id_, f"{to}: {note}")
        prev = to
    assert prev == status, (id_, prev, status)


action("AC-W-001", "AL-W-001", o["ref"], "u-manager", 12, "in_progress", 2, "approved", "Only qualified option that covers the horizon; request a firm quote and agree terms.", -4, [(-3, "u-manager", "in_progress", "Rouen Port Grain asked for a firm quote")])
action("AC-W-002", "AL-W-001", o["stock"], "u-analyst-b", -1, "review", 3, "approved", "Bridge cover with buffer stock from Plant Rotterdam while the supplier is arranged.", -3, [(-2, "u-analyst-b", "in_progress", "Quantity confirmed with the plant"), (-1.5, "u-analyst-b", "review", "Transfer complete, ready for review")])
action("AC-W-003", "AL-W-001", o["au"], "u-manager", 20, "open", 3, "approved", "Second source on a different route; decide before the quote lapses.", -2, [])
action("AC-W-004", "AL-W-006", a1, "u-manager", -12, "done", 2, "approved", "Used the US hard red winter lot to cover the Argentine gap.", -17, [(-16, "u-manager", "in_progress", "Order placed"), (-13, "u-analyst-a", "review", "Cargo received"), (-12, "u-manager", "done", "Closed after delivery")])
action("AC-W-005", "AL-W-003", u2, "u-analyst-a", 6, "in_progress", 1, "rejected", "Small stock transfer to cover the short Odesa delay.", -3, [(-2, "u-analyst-a", "in_progress", "Plant Milan agreed 300 t")])
action("AC-W-006", "AL-W-001", o["ca"], "u-analyst-wheat", 25, "open", 3, "approved", "Long-lead option for the following quarter.", -1, [])
action("AC-W-007", "AL-W-006", a2, "u-analyst-a", -15, "done", 2, "approved", "Drew down the Lyon buffer during the first week.", -17, [(-16, "u-analyst-a", "in_progress", "Transfer started"), (-15, "u-manager", "done", "Completed")])
action("AC-T-001", "AL-T-001", t2, "u-manager", 15, "in_progress", 3, "approved", "Highest-priced but shortest qualified lead time; start qualification samples.", -3, [(-2, "u-manager", "in_progress", "Goslar contacted for samples")])
action("AC-T-002", "AL-T-001", t5, "u-analyst-a", -2, "review", 2, "approved", "Bridge cover with strategic stock while sourcing is arranged.", -5, [(-4, "u-analyst-a", "in_progress", "Quantity check done"), (-3, "u-analyst-a", "review", "Ready for review")])
action("AC-T-003", "AL-T-001", t1, "u-manager", -1, "done", 2, "approved", "Framework order with the Vietnamese refinery agreed.", -5, [(-4, "u-manager", "in_progress", "Terms negotiated"), (-1, "u-manager", "done", "Order confirmed")])
action("AC-T-004", "AL-T-002", r3, "u-analyst-b", 9, "open", 1, "proposed", "Prepare to release stock if the assumption is approved.", -1, [])
action("AC-T-005", "AL-T-001", t6, "u-analyst-tungsten", 10, "open", 3, "approved", "Spot cover for the gap before the first APT shipment; decide before the quote lapses.", -1, [])

# ------------------------------------------------------------------------------------------------
# Imports, rules history in the audit trail, source runs, quarantine, dead letter
# ------------------------------------------------------------------------------------------------

NETWORK_CSV = "from_id,to_id,material,source,effective_from,confidence\nw-rott,w-p-duisburg,flour input,Curated file v1,2024-01-01,medium\n"
DEMAND_CSV = "plant_id,material,rate_per_day,unit,as_of\nw-p-duisburg,wheat flour input,40,t,2026-11-03\nt-p-essen,tungsten carbide powder,0.06,t,2026-11-03\n"
for i, (ds, version, rows, rejected, applied, csv, d) in enumerate([("supplier_network", 1, 71, 2, True, NETWORK_CSV, -12), ("demand", 1, 9, 0, False, DEMAND_CSV, -3)], 1):
    T["import_record"].append(dict(id=f"IMP-{i:03d}", dataset=ds, version=version, rows=rows, rejected=rejected,
                                   checksum=sha256(csv.encode()).hexdigest(), committed_by=NAME["u-steward"], committed_at=ts(d), applied=applied, content=csv))
    audit(ts(d), NAME["u-steward"], "import.committed", f"IMP-{i:03d}", f"{ds} v{version}: {rows} accepted, {rejected} quarantined")
for rid, name, com, versions in RULES:
    for v, status, thr, cd, cby, pd, pby in versions:
        audit(ts(cd), cby, "rule.draft", rid, f"version {v}")
        if pd is not None:
            audit(ts(pd, hours=1), pby, "rule.published", rid, f"version {v}")

# quarantined samples: replayable (the record is kept) and one legacy row (it is not)
bad = [
    ("policy", "wheat", None, "export_restriction", "Export restriction announced, country missing in the source record", 62, 2, "country", "", "Missing required field: country", dict(country=None)),
    ("policy", "wheat", "Rossiya", "export_restriction", "Export restriction announced, country spelled in an unknown way", 66, 3, "country", "Rossiya", "Unresolved location: 'Rossiya' is not a known country or alias", None),
    ("price", "tungsten", None, "price_change_30d_pct", "Tungsten price report with an impossible confidence value", 150, 4, "confidencePct", "150", "confidencePct is not valid: Input should be less than or equal to 100", None),
]
qn = 0
for kind, com, country, et, head, conf, d, field, badv, reason, _ in bad:
    qn += 1
    pub = ts(-d, hours=5)
    # a missing country is simply left out of the stored payload, exactly as a faulty source would send it
    c = collect(kind, com, country, et, head, conf, pub, "simulated", f"history / run-{4900 + qn}", 18.5 if kind == "price" else None)
    T["quarantine_item"].append(dict(id=f"Q-{qn:04d}", source_id=c["src"], run_id=c["ing"], received_at=c["got"], reason=reason,
                                     source_row=f"record 1 of {c['key'].rsplit('/', 1)[-1]}", object_key=c["key"], field=field, bad_value=badv,
                                     status="quarantined", correction=None, ingestion_id=c["ing"], record_json=json.dumps(c["rec"], sort_keys=True)))
    T["ingestion_run"].append(dict(id=nxt("RUN-", 4), source_id=c["src"], started_at=c["got"], status="failed", accepted=0, duplicate=0, quarantined=1, note=f"{c['ing']} ({MAPPING[kind]})"))
qn += 1
T["quarantine_item"].append(dict(id=f"Q-{qn:04d}", source_id="src-logistics", run_id="RUN-legacy", received_at=ts(-9), reason="delay_days is not a number",
                                 source_row="row 3 of obs-000130.json", object_key="evidence/legacy/src-logistics/obs-000130.json", field="delay_days",
                                 bad_value="three", status="quarantined", correction=None, ingestion_id=None, record_json=None))
for i in range(2):  # rows rejected by the first supplier-network import
    qn += 1
    T["quarantine_item"].append(dict(id=f"Q-{qn:04d}", source_id="src-import", run_id="IMP-001", received_at=ts(-12), reason=["effective_from is not a valid date (YYYY-MM-DD)", "to_id is not a known supplier or site"][i],
                                     source_row=f"row {[14, 33][i]} of IMP-001.csv", object_key="evidence/import/IMP-001.csv", field=["effective_from", "to_id"][i],
                                     bad_value=["2025-13-02", "w-nowhere"][i], status="resolved" if i == 0 else "quarantined", correction="2025-03-02" if i == 0 else None,
                                     ingestion_id=None, record_json=None))

# a resolved replay in the history, for the quarantine trail
audit(ts(-6), "Data Steward", "quarantine.replay_requested", "Q-0005", "corrected value: 2025-03-02")
audit(ts(-6, minutes=1), "Ingestion worker", "quarantine.replayed", "Q-0005", "accepted")

T["dead_letter"] += [
    dict(id="DL-0001", source_id="src-policy", received_at=ts(-11), reason="Schema version 9 not supported (mapping v1 only)", object_key="evidence/simulated/src-policy/20261029/obs-000099.json", attempts=1),
    dict(id="DL-0002", source_id="src-logistics", received_at=ts(-5), reason="Gave up after 3 attempts: EvidenceMissing: evidence/simulated/src-logistics/20261104/obs-000217.json", object_key="evidence/simulated/src-logistics/20261104/obs-000217.json", attempts=3),
]

# a believable run history: policy and logistics collect most days, price series daily, one recent outage
for d in range(10, 0, -1):
    T["ingestion_run"].append(dict(id=nxt("RUN-", 4), source_id="src-policy", started_at=ts(-d, hours=-4), status="ok", accepted=1 + d % 3, duplicate=d % 4 == 0, quarantined=0, note="Scheduled collection"))
    T["ingestion_run"].append(dict(id=nxt("RUN-", 4), source_id="src-price", started_at=ts(-d, hours=-6), status="ok", accepted=30, duplicate=0, quarantined=0, note="Daily price series"))
    if d > 2:
        T["ingestion_run"].append(dict(id=nxt("RUN-", 4), source_id="src-logistics", started_at=ts(-d, hours=-8), status="ok", accepted=4 + d % 3, duplicate=0, quarantined=1 if d == 6 else 0, note="Scheduled collection"))
for r in T["ingestion_run"]:
    r["duplicate"] = int(r["duplicate"])
T["ingestion_run"] += [
    dict(id=nxt("RUN-", 4), source_id="src-logistics", started_at=ts(hours=-20), status="failed", accepted=0, duplicate=0, quarantined=0, note="HTTP 429, retried after backoff; no usable data"),
    dict(id=nxt("RUN-", 4), source_id="src-logistics", started_at=ts(hours=-8), status="failed", accepted=0, duplicate=0, quarantined=0, note="Timeout after 30 s"),
]
for r in T["ingestion"]:  # one run per ingested payload that became an alert or observation
    T["ingestion_run"].append(dict(id=nxt("RUN-", 4), source_id=r["source_id"], started_at=r["received_at"], status="ok", accepted=1, duplicate=0, quarantined=0, note=f"{r['id']} ({r['mapping_version']})"))

for r in sorted(AUDIT, key=lambda r: r["at"]):
    T["audit_event"].append(r)

# ------------------------------------------------------------------------------------------------
# Write
# ------------------------------------------------------------------------------------------------

ORDER = ["person", "country", "country_alias", "commodity_form", "unit_conversion", "source", "source_commodity", "rule", "rule_version",
         "evidence", "ingestion", "node", "supply_edge", "alert", "observation", "alert_exposed_node", "response_option", "assumption",
         "assessment", "action", "action_status_history", "audit_event", "ingestion_run", "quarantine_item", "dead_letter", "import_record",
         "option_shortlist"]
missing = set(T) - set(ORDER)
assert not missing, missing
out = {"_meta": {"anchor": iso(ANCHOR), "description": "Demo data: real geography, fictional companies, synthetic events"}, "_evidence": EVIDENCE}
for name in ORDER:
    out[name] = T[name]
OUT.write_text(json.dumps(out, indent=1, default=lambda o: float(o) if isinstance(o, Decimal) else str(o)) + "\n")
print(f"wrote {OUT}")
for name in ORDER:
    print(f"  {name}: {len(T[name])}")
print(f"  evidence payloads: {len(EVIDENCE)}")
