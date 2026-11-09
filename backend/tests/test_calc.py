from decimal import Decimal as D

from app.calc import calculate, cover_days, d

# Worked example: docs/data-to-dashboard-workflow.md section 6.
WHEAT = dict(usable_stock=D(120), demand_per_day=D(20), baseline_price=D(200), exposed_value=D(100))


def run(**kw):
    base = dict(
        approved_share_pct=D(100), unavailable_reason=None, reference_lead_days=10, reference_price=D(230), **WHEAT
    )
    base.update(kw)
    return calculate(**base)


def test_wheat_worked_example():
    r = run()
    assert r.cover_days == D(6)
    assert r.at_risk == D(100)
    assert r.gap_days == D(4)
    assert r.incremental_cost == D(3000)
    assert r.reason is None


def test_without_an_approved_assumption_only_cover_is_available():
    r = run(approved_share_pct=None, unavailable_reason="The disruption assumption is awaiting approval.")
    assert r.cover_days == D(6)
    assert (r.at_risk, r.gap_days, r.incremental_cost) == (None, None, None)
    assert r.reason == "The disruption assumption is awaiting approval."


def test_gap_is_floored_at_zero_when_cover_exceeds_lead_time():
    assert run(reference_lead_days=3).gap_days == D(0)


def test_zero_or_unknown_demand_gives_no_cover_and_no_gap():
    assert cover_days(D(120), D(0)) is None
    r = run(demand_per_day=D(0))
    assert r.cover_days is None and r.gap_days is None
    assert r.incremental_cost == D(3000)  # cost does not depend on cover


def test_missing_reference_price_leaves_cost_unavailable():
    assert run(reference_price=None).incremental_cost is None


def test_share_scales_at_risk_and_cost():
    r = run(approved_share_pct=D(60), exposed_value=D(18), usable_stock=D(9), demand_per_day=D("0.2"),
            baseline_price=D(38000), reference_price=D(46000), reference_lead_days=60)
    assert r.at_risk == D("10.8")
    assert r.cover_days == D(45)
    assert r.gap_days == D(15)
    assert r.incremental_cost == D(86400)


def test_cost_rounds_half_up_to_a_whole_unit():
    r = run(approved_share_pct=D(50), exposed_value=D(1), reference_price=D("201.01"))  # 0.5 * 1.01 = 0.505
    assert r.incremental_cost == D(1)


def test_json_numbers_convert_without_binary_float_error():
    assert d(0.1) + d(0.2) == D("0.3")
