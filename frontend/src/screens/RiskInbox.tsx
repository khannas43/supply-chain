import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../data/store'
import type { Disposition, Mode, Severity } from '../data/types'
import { useApp } from '../components/AppContext'
import { useAuth } from '../auth/AuthContext'
import {
  AssessmentBadge, ConfidenceBadge, DispositionBadge, ModeBadge, PageHead, SeverityBadge, formatTime,
} from '../components/ui'

const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 }

export function RiskInbox() {
  const { commodity, openEvidence } = useApp()
  const { can } = useAuth()
  const [params, setParams] = useSearchParams()
  const { alerts: items, setDisposition } = useStore()
  const [sev, setSev] = useState<'all' | Severity>('all')
  const [mode, setMode] = useState<'all' | Mode>('all')
  const [disp, setDisp] = useState<'all' | Disposition>('all')
  const [rationale, setRationale] = useState('')
  const [pending, setPending] = useState<Disposition | null>(null)
  const [log, setLog] = useState<string[]>([])

  const rows = useMemo(
    () =>
      items
        .filter((a) => a.commodity === commodity)
        .filter((a) => (sev === 'all' ? true : a.severity === sev))
        .filter((a) => (mode === 'all' ? true : a.mode === mode))
        .filter((a) => (disp === 'all' ? true : a.disposition === disp))
        .sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.observedAt.localeCompare(a.observedAt)),
    [items, commodity, sev, mode, disp],
  )

  const selId = params.get('alert')
  const selected = rows.find((a) => a.id === selId) ?? null
  const select = (id: string | null) => {
    setPending(null)
    setRationale('')
    setLog([])
    setParams(id ? { alert: id } : {})
  }

  const apply = () => {
    if (!selected || !pending || !rationale.trim()) return
    setDisposition(selected.id, pending, rationale.trim())
    setLog((l) => [`${pending} recorded with rationale (demo state, resets on reload)`, ...l])
    setPending(null)
    setRationale('')
  }

  return (
    <div className="page">
      <PageHead title="Risk inbox">
        Review risk signals and decide what to do with them. Severity and confidence are separate, and a regional hazard is not proof of a supplier disruption.
      </PageHead>

      <div className="row">
        <div className="field"><label htmlFor="f-sev">Severity</label>
          <select id="f-sev" value={sev} onChange={(e) => setSev(e.target.value as 'all' | Severity)}>
            <option value="all">All</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
          </select></div>
        <div className="field"><label htmlFor="f-mode">Mode</label>
          <select id="f-mode" value={mode} onChange={(e) => setMode(e.target.value as 'all' | Mode)}>
            <option value="all">All</option><option value="live">Live</option><option value="replay">Replay</option><option value="simulated">Simulated</option>
          </select></div>
        <div className="field"><label htmlFor="f-disp">Disposition</label>
          <select id="f-disp" value={disp} onChange={(e) => setDisp(e.target.value as 'all' | Disposition)}>
            <option value="all">All</option><option value="new">New</option><option value="confirmed">Confirmed</option><option value="monitor">Monitor</option><option value="dismissed">Dismissed</option>
          </select></div>
      </div>

      <div className="split">
        <section className="card" style={{ padding: 0 }}>
          {rows.length === 0 ? (
            <div className="empty">No alerts match these filters.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Alert</th><th>Severity</th><th>Confidence</th><th>Observed</th><th>Mode</th><th>Assessment</th><th>Disposition</th></tr></thead>
                <tbody>
                  {rows.map((a) => (
                    <tr
                      key={a.id}
                      className={`clickable ${a.id === selId ? 'sel' : ''}`}
                      tabIndex={0}
                      onClick={() => select(a.id)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), select(a.id))}
                      aria-selected={a.id === selId}
                    >
                      <td><strong>{a.title}</strong><div className="muted small">{a.location} · {a.id}</div></td>
                      <td><SeverityBadge value={a.severity} /></td>
                      <td><ConfidenceBadge value={a.confidence} /></td>
                      <td>{formatTime(a.observedAt)}</td>
                      <td><ModeBadge mode={a.mode} /></td>
                      <td><AssessmentBadge value={a.assessmentStatus} /></td>
                      <td><DispositionBadge value={a.disposition} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="detail" aria-live="polite">
          {!selected ? (
            <div className="card empty">Select an alert to see its evidence, rule and linked suppliers.</div>
          ) : (
            <>
              <section className="card">
                <header><h2>{selected.title}</h2><button className="btn" onClick={() => select(null)}>Close</button></header>
                <p style={{ marginTop: 0 }}>{selected.summary}</p>
                <dl className="kv">
                  <dt>Location</dt><dd>{selected.location}</dd>
                  <dt>Observed</dt><dd>{formatTime(selected.observedAt)}</dd>
                  <dt>Mode</dt><dd><ModeBadge mode={selected.mode} /> {selected.scenarioRun && <span className="muted small">{selected.scenarioRun}</span>}</dd>
                  <dt>Rule</dt><dd>{selected.ruleVersion}</dd>
                  <dt>Rule inputs</dt><dd>{selected.ruleInputs.join('; ')}</dd>
                  <dt>Assessment</dt><dd><AssessmentBadge value={selected.assessmentStatus} /></dd>
                </dl>
                <div className="row" style={{ marginTop: 12 }}>
                  <button
                    className="btn"
                    onClick={() => openEvidence({ title: selected.title, evidence: selected.evidence, mode: selected.mode, scenarioRun: selected.scenarioRun, ruleVersion: selected.ruleVersion })}
                  >View evidence</button>
                  {selected.exposedNodeIds.length > 0 ? (
                    <Link className="btn" to={`/network?focus=${selected.exposedNodeIds[0]}&alert=${selected.id}`}>Open supplier path</Link>
                  ) : (
                    <span className="muted small">No supplier link matched yet</span>
                  )}
                  <Link className="btn" to={`/impact?alert=${selected.id}`}>Impact</Link>
                </div>
                {selected.exposedNodeIds.length === 0 && (
                  <div className="notice" style={{ marginTop: 12 }}>No dependency matched. This is not evidence of zero exposure.</div>
                )}
              </section>

              <section className="card">
                <header><h2>Disposition</h2><DispositionBadge value={selected.disposition} /></header>
                {can('alert.disposition') ? (
                  <>
                    <div className="row">
                      {(['confirmed', 'monitor', 'dismissed'] as const).map((d) => (
                        <button key={d} className={`btn ${pending === d ? 'primary' : ''}`} onClick={() => setPending(d)}>
                          {d[0].toUpperCase() + d.slice(1)}
                        </button>
                      ))}
                    </div>
                    {pending && (
                      <div className="field" style={{ marginTop: 10 }}>
                        <label htmlFor="rationale">Rationale (required)</label>
                        <textarea id="rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} />
                        <div><button className="btn primary" disabled={!rationale.trim()} onClick={apply}>Record {pending}</button></div>
                      </div>
                    )}
                    {log.map((l, i) => <div key={i} className="muted small" style={{ marginTop: 8 }}>{l}</div>)}
                  </>
                ) : (
                  <div className="muted">Only a Risk Analyst can set a disposition.</div>
                )}
              </section>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
