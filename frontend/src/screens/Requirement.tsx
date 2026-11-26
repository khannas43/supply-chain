import { Link } from 'react-router-dom'
import { PageHead } from '../components/ui'
import { FORMS, GRADES, qualFor, SUPPLIERS, SUPPLIER_BY_ID, TIMEFRAMES, isEmerging, type Requirement as Req } from '../prototype/data'
import { QualBadge, RepresentativeBadge } from '../prototype/parts'
import { useSelection } from '../prototype/selection'

export function Requirement() {
  const { requirement, setRequirement, selected, limit, add, remove } = useSelection()
  const set = <K extends keyof Req>(k: K, v: Req[K]) => setRequirement({ ...requirement, [k]: v })

  const volumeOk = Number.isFinite(requirement.volumeT) && requirement.volumeT > 0
  const deliveryOk = requirement.delivery.trim().length > 0
  const notSelected = SUPPLIERS.filter((s) => !selected.includes(s.id))
  const overLimit = selected.length > limit
  const canCompare = volumeOk && deliveryOk && selected.length >= 2 && !overLimit

  return (
    <div className="page">
      <PageHead title="Requirement">
        Define the purchase the comparison is for. Volume and product form feed the landed cost, the capacity check and the knock-out rules.
      </PageHead>
      <div className="row"><RepresentativeBadge /><span className="muted small">Prototype for buyer review. In the service the delivery team records this from the client’s requirement template.</span></div>

      <section className="card">
        <header><h2>Purchase requirement</h2></header>
        <div className="filters">
          <div className="field"><label htmlFor="r-commodity">Commodity</label><input id="r-commodity" value="Tungsten" disabled /></div>
          <div className="field">
            <label htmlFor="r-form">Product form</label>
            <select id="r-form" value={requirement.form} onChange={(e) => set('form', e.target.value)}>{FORMS.map((f) => <option key={f}>{f}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor="r-grade">Grade</label>
            <select id="r-grade" value={requirement.grade} onChange={(e) => set('grade', e.target.value)}>{GRADES.map((g) => <option key={g}>{g}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor="r-vol">Volume (tonnes)</label>
            <input id="r-vol" type="number" min={1} value={Number.isFinite(requirement.volumeT) ? requirement.volumeT : ''} aria-invalid={!volumeOk}
              onChange={(e) => set('volumeT', e.target.value === '' ? NaN : Number(e.target.value))} />
            {!volumeOk && <span className="bad-text small" role="alert">Enter a volume above zero.</span>}
          </div>
          <div className="field">
            <label htmlFor="r-time">Timeframe</label>
            <select id="r-time" value={requirement.timeframe} onChange={(e) => set('timeframe', e.target.value)}>{TIMEFRAMES.map((t) => <option key={t}>{t}</option>)}</select>
          </div>
          <div className="field">
            <label htmlFor="r-del">Delivery point</label>
            <input id="r-del" value={requirement.delivery} aria-invalid={!deliveryOk} onChange={(e) => set('delivery', e.target.value)} />
            {!deliveryOk && <span className="bad-text small" role="alert">Enter a delivery point.</span>}
          </div>
        </div>
      </section>

      <section className="card">
        <header>
          <h2>Suppliers to compare</h2>
          <span className="muted small">{selected.length} of {limit}. Add or remove at any stage.</span>
        </header>
        {selected.length === 0 ? (
          <div className="empty">No suppliers selected. <Link to="/suppliers">Choose from the dashboard</Link>.</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Supplier</th><th>Country</th><th>Qualification</th><th>{requirement.form} offered</th><th>Capacity vs {volumeOk ? requirement.volumeT : '–'} t</th><th /></tr></thead>
              <tbody>
                {selected.map((id) => {
                  const s = SUPPLIER_BY_ID[id]
                  const offers = s.forms.includes(requirement.form)
                  const cap = s.capacityT == null ? <span className="muted">Not disclosed</span>
                    : volumeOk && s.capacityT < requirement.volumeT ? <span className="badge b-warn">{s.capacityT.toLocaleString('en-GB')} t/yr: below volume</span>
                      : <span className="badge b-ok">{s.capacityT.toLocaleString('en-GB')} t/yr</span>
                  return (
                    <tr key={id}>
                      <td><Link to={`/suppliers/${s.id}`}>{s.name}</Link>{isEmerging(s) && <> <span className="badge b-live">Emerging</span></>}</td>
                      <td>{s.country}</td>
                      <td><QualBadge value={qualFor(s, requirement.form)} /></td>
                      <td>{offers ? <span className="badge b-ok">Yes</span> : <span className="badge b-bad" title="Excluded in the comparison">No</span>}</td>
                      <td>{cap}</td>
                      <td><button className="btn" onClick={() => remove(id)} aria-label={`Remove ${s.name}`}>Remove</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          {selected.length < limit && notSelected.length > 0 && (
            <select aria-label="Add a supplier" value="" onChange={(e) => e.target.value && add(e.target.value)}>
              <option value="">+ Add supplier…</option>
              {notSelected.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.country})</option>)}
            </select>
          )}
          <Link to="/suppliers" className="small">Back to dashboard</Link>
          <span className="spacer" style={{ flex: 1 }} />
          {selected.length < 2 && <span className="muted small">Select at least two suppliers to compare.</span>}
          {overLimit && <span className="bad-text small" role="alert">{selected.length} selected; the limit is {limit}. Remove {selected.length - limit}.</span>}
          <Link to="/data" className="btn primary" aria-disabled={!canCompare}>Continue to data & quotes</Link>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Qualification is confirmed by the client’s Engineering/Quality Lead and recorded per product form in the Supplier Master; this prototype holds it for APT only. A supplier that does not offer the chosen form is excluded in the comparison.
        </p>
      </section>
    </div>
  )
}
