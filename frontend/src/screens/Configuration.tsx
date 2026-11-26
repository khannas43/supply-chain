import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { PageHead, formatTime } from '../components/ui'
import { CONFIG, DEFAULT_WEIGHTS, DIMS } from '../prototype/data'
import { LIMIT_MAX, LIMIT_MIN, setComparisonLimit, useSettings, validateLimit } from '../prototype/settings'
import { useSelection } from '../prototype/selection'

export function Configuration() {
  const { user, can } = useAuth()
  const { comparisonLimit, log } = useSettings()
  const { selected } = useSelection()
  const [draft, setDraft] = useState(String(comparisonLimit))
  const [saved, setSaved] = useState(false)
  const editable = can('config.edit')
  const n = draft.trim() === '' ? NaN : Number(draft)
  const error = validateLimit(n)
  const dirty = n !== comparisonLimit

  const save = () => {
    if (error) return
    const err = setComparisonLimit(n, user.name)
    if (!err) setSaved(true)
  }

  return (
    <div className="page">
      <PageHead title="Configuration">
        Settings the delivery team maintains without a code change. Every change is logged. A full administration console follows in Phase 2.
      </PageHead>

      <section className="card">
        <header><h2>Comparison limit</h2><span className="muted small">Current: {comparisonLimit} suppliers</span></header>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div className="field">
            <label htmlFor="cfg-limit">Most suppliers in one comparison ({LIMIT_MIN} to {LIMIT_MAX})</label>
            <input id="cfg-limit" type="number" min={LIMIT_MIN} max={LIMIT_MAX} value={draft} disabled={!editable} aria-invalid={!!error}
              onChange={(e) => { setDraft(e.target.value); setSaved(false) }} style={{ width: 120 }} />
          </div>
          <button className="btn primary" onClick={save} disabled={!editable || !!error || !dirty}>Save</button>
          <button className="btn" onClick={() => { setDraft(String(CONFIG.comparisonLimit)); setSaved(false) }} disabled={!editable || draft === String(CONFIG.comparisonLimit)}>Use proposed default ({CONFIG.comparisonLimit})</button>
        </div>
        {error && dirty && <p className="bad-text small" role="alert">{error}</p>}
        {saved && !dirty && <p className="ok-text small" role="status">Saved. It applies immediately to the dashboard, requirement and comparison.</p>}
        {!editable && <p className="muted small">Your role can view but not change settings.</p>}
        {selected.length > comparisonLimit && (
          <div className="notice" role="alert">{selected.length} suppliers are currently selected, above the limit of {comparisonLimit}. The comparison stays paused until <Link to="/requirement">{selected.length - comparisonLimit} are removed</Link>.</div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>
          Ten is proposed. The dashboard stops further selection at the limit, and the heatmap and decision pack are built to stay readable at the limit. Performance (three seconds) is checked at the configured limit.
        </p>
      </section>

      <section className="card">
        <header><h2>Other settings</h2><span className="muted small">Read-only in this prototype; editable in Sprint 2</span></header>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Setting</th><th>Value</th></tr></thead>
            <tbody>
              <tr><td>Rating bands (1 = most favourable)</td><td>Green below {CONFIG.greenBelow}, red above {CONFIG.redAbove}, amber between</td></tr>
              <tr><td>Minimum data to rank</td><td>{CONFIG.minCoverage * 100}% of applicable metrics, and at least one per dimension</td></tr>
              <tr><td>Default weightings</td><td>{DIMS.map((d) => `${d.short} ${DEFAULT_WEIGHTS[d.id]}%`).join(' · ')}</td></tr>
              <tr><td>Reference price for indicative cost</td><td>USD {CONFIG.referencePriceUsdPerT.toLocaleString('en-GB')} per tonne APT (as of {CONFIG.referencePriceAsOf})</td></tr>
              <tr><td>Indicative freight, insurance and handling</td><td>{CONFIG.indicativeFreightPct * 100}% of goods value</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <header><h2>Change log</h2><span className="muted small">{log.length} {log.length === 1 ? 'change' : 'changes'}</span></header>
        {log.length === 0 ? <div className="empty">No changes yet. The limit is at its proposed value.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Who</th><th>Setting</th><th>From</th><th>To</th></tr></thead>
              <tbody>{log.map((e, i) => <tr key={i}><td>{formatTime(e.at)}</td><td>{e.by}</td><td>{e.setting}</td><td>{e.from}</td><td>{e.to}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
