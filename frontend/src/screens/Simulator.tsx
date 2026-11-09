import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/hooks'
import type { FailureKind, ScenarioData, SimState } from '../api/types'
import { PageHead, formatTime } from '../components/ui'

const FAILURES: { k: FailureKind; label: string; hint: string }[] = [
  { k: 'rate_limit', label: 'Rate limit (429)', hint: 'Collection retries after the hinted delay' },
  { k: 'timeout', label: 'Source timeout', hint: 'Logistics feed fails; last usable data is kept' },
  { k: 'recover', label: 'Recover source', hint: 'Logistics feed delivers again' },
  { k: 'duplicate', label: 'Duplicate delivery', hint: 'Counted once, no second alert' },
  { k: 'late', label: 'Late / out-of-order', hint: 'Kept as history, current value not overwritten' },
  { k: 'malformed', label: 'Malformed payload', hint: 'Goes to quarantine' },
  { k: 'missing_field', label: 'Missing required field', hint: 'Goes to quarantine' },
]

export function Simulator() {
  const scenarios = useApi<ScenarioData[]>('/simulator/scenarios')
  const run = useApi<SimState>('/simulator/run', { pollMs: 5000 })
  const [pick, setPick] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const sim = run.data
  const list = scenarios.data ?? []
  const chosen = pick || list[0]?.id || ''
  const live = !!sim && sim.status !== 'idle'
  const sc = list.find((s) => s.id === (live ? sim!.scenarioId : chosen))

  const act = async (path: string, body?: unknown) => {
    setBusy(true)
    setError(null)
    try {
      await api.post(path, body ?? {})
      run.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <PageHead title="Simulator control">
        Drive a repeatable scenario without live feeds. Everything produced is labelled simulated and carries the scenario and run ID. Resetting a run never deletes decisions or actions.
      </PageHead>
      {(error || run.error || scenarios.error) && <div className="notice" role="alert">{error ?? run.error ?? scenarios.error}</div>}
      {!sim || !scenarios.data ? !(run.error || scenarios.error) && <div className="empty" role="status">Loading…</div> : (
        <>
          <div className="grid two">
            <section className="card">
              <header><h2>Scenario</h2>
                <span className={`badge ${sim.status === 'running' ? 'b-ok' : sim.status === 'paused' ? 'b-warn' : 'b-neutral'}`}>{sim.status}</span></header>
              <div className="field">
                <label htmlFor="sc">Scenario</label>
                <select id="sc" value={live ? sim.scenarioId! : chosen} disabled={live} onChange={(e) => setPick(e.target.value)}>
                  {list.map((s) => <option key={s.id} value={s.id}>{s.name} (seed {s.seed})</option>)}
                </select>
              </div>
              <dl className="kv" style={{ margin: '12px 0' }}>
                <dt>Run ID</dt><dd className="mono">{sim.runId ?? '—'}</dd>
                <dt>Seed</dt><dd>{sim.seed ?? sc?.seed ?? '—'}</dd>
                <dt>Virtual clock</dt><dd>{formatTime(sim.virtualNow)} <span className="muted small">(+{sim.offsetHours} h)</span></dd>
                <dt>Events emitted</dt><dd>{sim.emitted}{live ? ` of ${sim.totalEvents}` : ''}</dd>
              </dl>
              <div className="row">
                {!live && <button className="btn primary" disabled={busy || !chosen} onClick={() => act('/simulator/runs', { scenarioId: chosen })}>Start run</button>}
                {live && <button className="btn" disabled={busy} onClick={() => act(sim.status === 'running' ? '/simulator/run/pause' : '/simulator/run/resume')}>{sim.status === 'running' ? 'Pause' : 'Resume'}</button>}
                {live && <button className="btn" disabled={busy || sim.status !== 'running'} onClick={() => act('/simulator/run/advance', { hours: 6 })}>Advance 6 h</button>}
                {live && <button className="btn" disabled={busy || sim.status !== 'running'} onClick={() => act('/simulator/run/advance', { hours: 24 })}>Advance 1 day</button>}
                {live && <button className="btn" disabled={busy} onClick={() => act('/simulator/run/reset')}>Reset</button>}
              </div>
              {sc && <p className="muted small">Scripted events: {sc.events.map((e) => `+${e.at} h`).join(', ')}. Same seed and clock give the same events.</p>}
            </section>

            <section className="card">
              <header><h2>Failure injection</h2><span className="muted small">needs a running run</span></header>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                {FAILURES.map((f) => (
                  <div key={f.k}>
                    <button className="btn" style={{ width: '100%' }} disabled={busy || sim.status !== 'running'} onClick={() => act('/simulator/run/inject', { kind: f.k })}>{f.label}</button>
                    <div className="muted small">{f.hint}</div>
                  </div>
                ))}
              </div>
              <p className="muted small" style={{ marginBottom: 0 }}>Effects show up on <Link to="/sources">Source health</Link>: runs, quarantine and source state.</p>
            </section>
          </div>

          <section className="card">
            <header><h2>Run log</h2></header>
            {sim.log.length === 0 ? <div className="empty">Start a run to see what the simulator emits.</div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Virtual time</th><th>Run</th><th>Event</th></tr></thead>
                <tbody>{[...sim.log].reverse().map((l, i) => <tr key={i}><td>{formatTime(l.at)}</td><td className="mono">{l.runId}</td><td>{l.text} <span className="badge b-sim">Simulated</span></td></tr>)}</tbody>
              </table></div>
            )}
            {sim.log.length > 0 && <p className="muted small" style={{ marginBottom: 0 }}>Each event is collected as evidence and processed by the worker, so a moment later it appears in <Link to="/sources">source health</Link> and, if a published rule says so, as an alert in the <Link to="/risk">risk inbox</Link>.</p>}
          </section>
        </>
      )}
    </div>
  )
}
