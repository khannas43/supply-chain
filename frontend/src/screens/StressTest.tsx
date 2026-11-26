import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ModeBadge, PageHead } from '../components/ui'
import { CHINA_DEP, DESTINATIONS, DEFAULT_SCENARIO, SUPPLIER_BY_ID, compare, ratingOf, scenarioEffects, usd } from '../prototype/data'
import { SHARES, SPARE } from '../prototype/market'
import { RagBadge, RepresentativeBadge } from '../prototype/parts'
import { useQuotes } from '../prototype/quotes'
import { useSelection } from '../prototype/selection'

const pct = (x: number) => `${(x * 100).toFixed(0)}%`

export function StressTest() {
  const { selected, requirement, weights, scenario, setScenario, limit } = useSelection()
  const { version: qv } = useQuotes()
  const fx = scenarioEffects(scenario)
  const china = SHARES.find((s) => s.country === 'China')!.share
  const overLimit = selected.length > limit

  const { base, stress } = useMemo(() => ({
    base: compare(overLimit ? [] : selected, weights, requirement),
    stress: compare(overLimit ? [] : selected, weights, requirement, scenario),
  }), [selected, weights, requirement, scenario, overLimit, qv])

  const baseRank = new Map(base.ranked.map((a, i) => [a.supplier.id, i + 1]))
  const stressRank = new Map(stress.ranked.map((a, i) => [a.supplier.id, i + 1]))
  const moved = stress.ranked.filter((a) => (stressRank.get(a.supplier.id) ?? 0) > (baseRank.get(a.supplier.id) ?? 0)).length
  const set = (patch: Partial<typeof scenario>) => setScenario({ ...scenario, ...patch })
  const changed = scenario.severity !== DEFAULT_SCENARIO.severity || scenario.durationMonths !== DEFAULT_SCENARIO.durationMonths || scenario.destination !== DEFAULT_SCENARIO.destination

  return (
    <div className="page">
      <PageHead title="Stress test">
        Re-score and re-rank the selected suppliers if China tightens tungsten export licences. The route-disruption scenario is Phase 2.
      </PageHead>
      <div className="row"><RepresentativeBadge /><ModeBadge mode="simulated" /><span className="muted small">Credibl scenario template, called for each supplier’s origin; simulated until the API is available. Effects are shown as ranges.</span></div>

      <section className="card">
        <header><h2>Scenario: China export-licence tightening</h2><span className="muted small">Product {requirement.form} · HS 2841.80</span></header>
        <div className="row" style={{ alignItems: 'flex-end', gap: 20 }}>
          <div className="field">
            <label htmlFor="sc-sev">Severity: share of licensed volume withdrawn</label>
            <div className="row" style={{ gap: 6 }}>
              <input id="sc-sev" type="range" min={0} max={100} step={5} value={scenario.severity} onChange={(e) => set({ severity: Number(e.target.value) })} />
              <strong style={{ width: 44 }}>{scenario.severity}%</strong>
            </div>
          </div>
          <div className="field">
            <label htmlFor="sc-dur">Duration</label>
            <select id="sc-dur" value={scenario.durationMonths} onChange={(e) => set({ durationMonths: Number(e.target.value) })}>
              {[3, 6, 12].map((m) => <option key={m} value={m}>{m} months</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sc-dest">Destination country</label>
            <select id="sc-dest" value={scenario.destination} onChange={(e) => set({ destination: e.target.value })}>
              {DESTINATIONS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </div>
          <button className="btn" onClick={() => setScenario(DEFAULT_SCENARIO)} disabled={!changed}>Reset</button>
        </div>
      </section>

      <div className="grid tiles">
        <div className="tile"><h3>World supply affected</h3><div className="big">{pct(china * fx.sev)}</div><div className="sub">China’s {pct(china)} mine-supply share × {scenario.severity}% withdrawn</div></div>
        <div className="tile"><h3>Indicative price effect</h3><div className="big">+{pct(fx.priceLow)} to +{pct(fx.priceHigh)}</div><div className="sub">on suppliers fully dependent on China; scaled by each supplier’s dependence</div></div>
        <div className="tile"><h3>Lead-time effect</h3><div className="big">+{fx.leadLow.toFixed(1)} to +{fx.leadHigh.toFixed(1)} wk</div><div className="sub">range, for delivery to {scenario.destination}</div></div>
        <div className="tile"><h3>Suppliers moving down</h3><div className="big">{moved}</div><div className="sub">of {stress.ranked.length} ranked in the baseline</div></div>
      </div>

      {overLimit && <div className="notice" role="alert">{selected.length} suppliers are selected but the limit is {limit}. <Link to="/requirement">Remove {selected.length - limit}</Link> to run the scenario.</div>}

      <section className="card">
        <header><h2>Baseline and scenario ranking</h2><span className="muted small">Weightings as set on the comparison</span></header>
        {stress.ranked.length === 0 ? <div className="empty">No supplier can be ranked. Select suppliers and check the <Link to="/comparison">comparison</Link>.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Scenario rank</th><th>Supplier</th><th>Dependence on China</th><th>Baseline rank</th><th>Overall: baseline → scenario</th><th>Supply security</th><th>Geo & regulatory</th><th>Landed cost: baseline → scenario</th></tr></thead>
              <tbody>
                {stress.ranked.map((a) => {
                  const b = base.ranked.find((x) => x.supplier.id === a.supplier.id)
                  const br = baseRank.get(a.supplier.id) ?? 0, sr = stressRank.get(a.supplier.id) ?? 0
                  const dep = CHINA_DEP[a.supplier.id] ?? 0
                  return (
                    <tr key={a.supplier.id}>
                      <td><strong>{sr}</strong></td>
                      <td><Link to={`/suppliers/${a.supplier.id}`}>{a.supplier.name}</Link><div className="muted small">{a.supplier.country}</div></td>
                      <td>{dep === 0 ? <span className="muted">None known</span> : <span className="bar"><i style={{ width: `${dep * 60}px` }} />{pct(dep)}</span>}</td>
                      <td>{br}{sr > br ? <span className="bad-text"> ▼ {sr - br}</span> : sr < br ? <span className="ok-text"> ▲ {br - sr}</span> : <span className="muted"> =</span>}</td>
                      <td>{b?.overall?.toFixed(1)} → <RagBadge rating={ratingOf(a.overall)} score={a.overall} /></td>
                      <td>{b?.dims.security?.toFixed(1)} → {a.dims.security?.toFixed(1)}</td>
                      <td>{b?.dims.geo?.toFixed(1)} → {a.dims.geo?.toFixed(1)}</td>
                      <td className="small">{b && usd(b.landed.total)} → {usd(a.landed.total)}{a.landed.indicative && <> <span className="badge b-warn">Indicative</span></>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {[...stress.excluded, ...stress.insufficient, ...stress.review].length > 0 && (
          <p className="muted small" style={{ marginBottom: 0 }}>Not ranked in either case: {[...stress.excluded, ...stress.insufficient, ...stress.review].map((a) => SUPPLIER_BY_ID[a.supplier.id].name).join(', ')}.</p>
        )}
      </section>

      <div className="grid two">
        <section className="card">
          <header><h2>Alternative origins with spare capacity</h2><span className="muted small">kt tungsten content, representative</span></header>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Origin</th><th>Spare (kt)</th><th>Note</th></tr></thead>
              <tbody>{SPARE.map((s) => <tr key={s.country}><td>{s.country}</td><td>{s.kt}</td><td className="small">{s.note}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>Together this covers {SPARE.reduce((a, s) => a + s.kt, 0).toFixed(2)} kt against {(china * fx.sev * 83).toFixed(1)} kt of world supply affected.</p>
        </section>
        <section className="card">
          <header><h2>Assumptions</h2></header>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4 }}>
            <li>The scenario withdraws {scenario.severity}% of licensed Chinese volume for {scenario.durationMonths} months, for delivery to {scenario.destination}.</li>
            <li>Price effect: {pct(fx.priceLow)} to {pct(fx.priceHigh)} on a fully dependent supplier; the mid-point ({pct(fx.priceMid)}) is applied, scaled by dependence.</li>
            <li>Lead time: +{fx.leadMid.toFixed(1)} weeks (mid-point) scaled by dependence, applied where a quote gives a lead time.</li>
            <li>Supply-share and export-control scores rise with dependence and severity; other scores are unchanged.</li>
            <li>Dependence on China is a representative estimate per supplier and is shown as exposure, not as a predicted interruption. A country signal alone does not mean a supplier will be interrupted or a programme delayed.</li>
          </ul>
        </section>
      </div>
    </div>
  )
}
