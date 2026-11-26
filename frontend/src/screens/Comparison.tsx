import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHead } from '../components/ui'
import {
  CONFIG, DEFAULT_WEIGHTS, DIMS, PROFILES, SUPPLIERS, SUPPLIER_BY_ID, compare, isEmerging, ratingOf, robustness, tradeoffSummary, usd, weightsTotal,
  type Assessment, type Dim, type Supplier,
} from '../prototype/data'
import { RagBadge, RepresentativeBadge, SupplierDrawer } from '../prototype/parts'
import { useQuotes } from '../prototype/quotes'
import { useSelection } from '../prototype/selection'

function Heat({ a, dim, onOpen }: { a: Assessment; dim: Dim; onOpen: (s: Supplier, d: Dim) => void }) {
  const v = a.dims[dim]
  const r = ratingOf(v)
  return (
    <td className={`heat heat-${r}`}>
      <button className="heatbtn" onClick={() => onOpen(a.supplier, dim)} title="Open the evidence behind this score">
        <strong>{v == null ? '–' : v.toFixed(1)}</strong>
        <span className="small">{r === 'unknown' ? 'Unknown' : r[0].toUpperCase() + r.slice(1)}</span>
      </button>
    </td>
  )
}

export function Comparison() {
  const { selected, limit, add, remove, requirement, weights: applied, setWeights: setApplied, scenario } = useSelection()
  const { version: qv } = useQuotes()
  const [draft, setDraft] = useState<Record<Dim, number>>(() => ({ ...applied }))
  const [open, setOpen] = useState<{ s: Supplier; dim?: Dim } | null>(null)

  const total = weightsTotal(draft)
  const valid = total === 100
  // the ranking only recalculates for weightings that total 100%; otherwise the last valid result stays
  const setWeight = (d: Dim, raw: string) => {
    const n = raw === '' ? 0 : Math.max(0, Math.min(100, Number(raw)))
    const next = { ...draft, [d]: n }
    setDraft(next)
    if (weightsTotal(next) === 100) setApplied(next)
  }
  const reset = () => { setDraft({ ...DEFAULT_WEIGHTS }); setApplied({ ...DEFAULT_WEIGHTS }) }
  const isDefault = DIMS.every((d) => applied[d.id] === DEFAULT_WEIGHTS[d.id])

  const overLimit = selected.length > limit
  const result = useMemo(() => compare(overLimit ? [] : selected, applied, requirement), [selected, applied, requirement, overLimit, qv])
  const defaultRank = useMemo(() => compare(overLimit ? [] : selected, DEFAULT_WEIGHTS, requirement).ranked.map((a) => a.supplier.id), [selected, requirement, overLimit, qv])
  const robust = useMemo(() => (overLimit ? null : robustness(selected, requirement, applied, scenario)), [selected, requirement, applied, scenario, overLimit, qv])
  const summary = useMemo(() => tradeoffSummary(result, requirement), [result, requirement])
  const applyProfile = (w: Record<Dim, number>) => { setDraft({ ...w }); setApplied({ ...w }) }
  const notSelected = SUPPLIERS.filter((s) => !selected.includes(s.id))
  const enough = result.ranked.length >= 1

  return (
    <div className="page">
      <PageHead title="Comparison">
        Ranked comparison of the selected suppliers on total landed cost and three risk dimensions. Click any score for its source, date and calculation.
      </PageHead>
      <div className="row"><RepresentativeBadge /><span className="muted small">Prototype for buyer review: scoring follows the proposed rules, but the numbers are invented. The stress test, robustness check and decision pack come later.</span></div>

      <section className="card">
        <header>
          <h2>Requirement and suppliers</h2>
          <span className={overLimit ? 'bad-text small' : 'muted small'}>{selected.length} of {limit} suppliers (<Link to="/configuration">limit is a setting</Link>)</span>
        </header>
        <div className="row small" style={{ marginBottom: 10 }}>
          <span><strong>{requirement.commodity}</strong> · {requirement.form} · grade {requirement.grade}</span>
          <span>· {requirement.volumeT} t over {requirement.timeframe}</span>
          <span>· Delivery: {requirement.delivery}</span> <Link to="/requirement" className="small">Edit requirement</Link>
        </div>
        <div className="row">
          {selected.map((id) => (
            <span key={id} className="chip">
              {SUPPLIER_BY_ID[id].name}{isEmerging(SUPPLIER_BY_ID[id]) && ' (emerging)'}
              <button aria-label={`Remove ${SUPPLIER_BY_ID[id].name}`} onClick={() => remove(id)}>×</button>
            </span>
          ))}
          {!selected.length && <span className="muted">No suppliers selected. <Link to="/suppliers">Choose from the dashboard</Link>.</span>}
          {selected.length < limit && notSelected.length > 0 && (
            <select aria-label="Add a supplier" value="" onChange={(e) => e.target.value && add(e.target.value)}>
              <option value="">+ Add supplier…</option>
              {notSelected.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.country})</option>)}
            </select>
          )}
          <Link to="/suppliers" className="small">Back to dashboard</Link>
        </div>
      </section>

      {overLimit && <div className="notice" role="alert">{selected.length} suppliers are selected but the configured limit is {limit}. Remove {selected.length - limit} to run the comparison.</div>}

      <section className="card">
        <header>
          <h2>Weightings</h2>
          <span className={valid ? 'muted small' : 'bad-text small'} role="status">Total {total}% {valid ? '' : '— must equal 100% before the ranking updates'}</span>
        </header>
        <div className="row" style={{ alignItems: 'flex-end', gap: 16 }}>
          {DIMS.map((d) => (
            <div className="field" key={d.id}>
              <label htmlFor={`w-${d.id}`}>{d.label} (default {DEFAULT_WEIGHTS[d.id]}%)</label>
              <div className="row" style={{ gap: 6 }}>
                <input id={`w-${d.id}`} type="range" min={0} max={100} value={draft[d.id]} onChange={(e) => setWeight(d.id, e.target.value)} />
                <input type="number" min={0} max={100} value={draft[d.id]} onChange={(e) => setWeight(d.id, e.target.value)} style={{ width: 60 }} aria-label={`${d.short} weighting percent`} />
              </div>
            </div>
          ))}
          <button className="btn" onClick={reset} disabled={isDefault && valid}>Reset to defaults</button>
        </div>
        <div className="row small" style={{ marginTop: 10 }}>
          <span className="muted">Named profiles:</span>
          {PROFILES.map((p) => <button key={p.id} className="btn" onClick={() => applyProfile(p.weights)} title={DIMS.map((d) => `${d.short} ${p.weights[d.id]}%`).join(', ')}>{p.label}</button>)}
        </div>
        {!isDefault && <p className="muted small" style={{ marginBottom: 0 }}>Weightings differ from the defaults; the decision pack will also show the ranking under the defaults ({defaultRank.map((id) => SUPPLIER_BY_ID[id].name).join(' › ') || 'none'}).</p>}
      </section>

      <section className="card">
        <header><h2>Ranking</h2><span className="muted small">1 = most favourable · green below {CONFIG.greenBelow} · red above {CONFIG.redAbove}</span></header>
        {!enough ? (
          <div className="empty">{overLimit ? 'The comparison is paused until the selection is within the limit.' : 'No supplier can be ranked yet. Select at least two eligible suppliers with enough data.'}</div>
        ) : (
          <div className="table-wrap">
            <table className="rank">
              <thead>
                <tr>
                  <th>#</th><th>Supplier</th><th>Total landed cost</th><th>Overall</th>
                  {DIMS.map((d) => <th key={d.id}>{d.short}<span className="muted small"> {applied[d.id]}%</span></th>)}
                </tr>
              </thead>
              <tbody>
                {result.ranked.map((a, i) => (
                  <tr key={a.supplier.id}>
                    <td><strong>{i + 1}</strong></td>
                    <td>
                      <Link to={`/suppliers/${a.supplier.id}`}>{a.supplier.name}</Link>
                      <div className="muted small">{a.supplier.country}{isEmerging(a.supplier) && ' · emerging'}</div>
                      {a.landed.indicative && <span className="muted small">Lower confidence: no quote, price is indicative</span>}
                    </td>
                    <td>
                      <button className="linkbtn" onClick={() => setOpen({ s: a.supplier, dim: 'price' })}>{usd(a.landed.total)}</button>
                      {a.landed.indicative && <> <span className="badge b-warn">Indicative</span></>}
                      <div className="muted small">{usd(a.landed.perTonneWo3)} per t WO₃</div>
                    </td>
                    <td><RagBadge rating={ratingOf(a.overall)} score={a.overall} /></td>
                    {DIMS.map((d) => <Heat key={d.id} a={a} dim={d.id} onOpen={(s, dim) => setOpen({ s, dim })} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>
          Overall is the weighted average of the four dimension scores. Price score (prototype rule): landed cost per tonne against the {usd(CONFIG.referencePriceUsdPerT)}/t APT reference price, 1 at 95% or less and 5 at 115% or more.
          A supplier is ranked only if at least {CONFIG.minCoverage * 100}% of applicable metrics have data and every dimension has at least one.
        </p>
      </section>

      {summary.length > 0 && (
        <section className="card">
          <header><h2>Trade-offs in plain language</h2><span className="muted small">Generated from the figures above</span></header>
          {summary.map((t, i) => <p key={i} style={{ margin: '0 0 6px' }}>{t}</p>)}
        </section>
      )}

      {robust && robust.currentLeader && (
        <section className="card">
          <header>
            <h2>Robustness check</h2>
            <span className="muted small">Does the leader change?</span>
          </header>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Case</th><th>Leading supplier</th><th>Result</th></tr></thead>
              <tbody>
                {robust.rows.map((r) => (
                  <tr key={r.label}><td>{r.label}</td><td>{r.leader ?? <span className="muted">none ranked</span>}</td>
                    <td>{r.same ? <span className="badge b-ok">Same leader</span> : <span className="badge b-warn">Leader changes</span>}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Current leader: {robust.currentLeader}. {robust.rows.every((r) => r.same) ? 'It leads in every case tested, so the recommendation does not depend on the weightings or on the export-licence scenario.' : `It does not lead in every case: ${robust.rows.filter((r) => !r.same).length} of ${robust.rows.length} cases change the leader. Review before recommending.`} Set the scenario on the <Link to="/stress">Stress test</Link> screen.
          </p>
        </section>
      )}

      {(result.excluded.length > 0 || result.insufficient.length > 0 || result.review.length > 0) && (
        <section className="card">
          <header><h2>Not ranked</h2><span className="muted small">{result.excluded.length + result.insufficient.length + result.review.length} of {selected.length} selected</span></header>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Supplier</th><th>Status</th><th>Reason</th><th>Missing items</th></tr></thead>
              <tbody>
                {[...result.excluded, ...result.review, ...result.insufficient].map((a) => (
                  <tr key={a.supplier.id}>
                    <td><Link to={`/suppliers/${a.supplier.id}`}>{a.supplier.name}</Link><div className="muted small">{a.supplier.country}</div></td>
                    <td>
                      {a.status === 'excluded' && <span className="badge b-bad">Excluded (knock-out)</span>}
                      {a.status === 'review' && <span className="badge b-warn">Review required</span>}
                      {a.status === 'insufficient' && <span className="badge b-warn">Insufficient data</span>}
                    </td>
                    <td className="small">{a.reasons.map((r) => <div key={r}>{r}</div>)}{a.status === 'excluded' && <div className="muted">Excluded whatever its score or price.</div>}</td>
                    <td className="small">{a.status === 'insufficient' ? a.missing.map((m) => <div key={m}>{m}</div>) : <span className="muted">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {open && <SupplierDrawer s={open.s} dim={open.dim} onClose={() => setOpen(null)} />}
    </div>
  )
}
