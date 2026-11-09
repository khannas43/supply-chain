import { useState } from 'react'
import { Link } from 'react-router-dom'
import { PageHead, formatTime } from '../components/ui'
import { SCENARIOS, START, usePipeline, type FailureKind } from '../data/pipelineStore'

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
  const { sim, startRun, setPaused, advance, resetRun, inject, simNow } = usePipeline()
  const [pick, setPick] = useState<string>(SCENARIOS[0].id)
  const sc = SCENARIOS.find((s) => s.id === sim.scenarioId)
  const live = sim.status !== 'idle'

  return (
    <div className="page">
      <PageHead title="Simulator control">
        Drive a repeatable scenario without live feeds. Everything produced is labelled simulated and carries the scenario and run ID. Resetting a run never deletes decisions or actions.
      </PageHead>

      <div className="grid two">
        <section className="card">
          <header><h2>Scenario</h2>
            <span className={`badge ${sim.status === 'running' ? 'b-ok' : sim.status === 'paused' ? 'b-warn' : 'b-neutral'}`}>{sim.status}</span></header>
          <div className="field">
            <label htmlFor="sc">Scenario</label>
            <select id="sc" value={live ? sim.scenarioId! : pick} disabled={live} onChange={(e) => setPick(e.target.value)}>
              {SCENARIOS.map((s) => <option key={s.id} value={s.id}>{s.name} (seed {s.seed})</option>)}
            </select>
          </div>
          <dl className="kv" style={{ margin: '12px 0' }}>
            <dt>Run ID</dt><dd className="mono">{sim.runId ?? '—'}</dd>
            <dt>Seed</dt><dd>{sim.seed || SCENARIOS.find((s) => s.id === pick)!.seed}</dd>
            <dt>Virtual clock</dt><dd>{live ? formatTime(simNow()) : formatTime(START)} <span className="muted small">(+{sim.offsetHours} h)</span></dd>
            <dt>Events emitted</dt><dd>{sim.emitted}{sc ? ` of ${sc.events.length}` : ''}</dd>
          </dl>
          <div className="row">
            {!live && <button className="btn primary" onClick={() => startRun(pick)}>Start run</button>}
            {live && <button className="btn" onClick={() => setPaused(sim.status === 'running')}>{sim.status === 'running' ? 'Pause' : 'Resume'}</button>}
            {live && <button className="btn" disabled={sim.status !== 'running'} onClick={() => advance(6)}>Advance 6 h</button>}
            {live && <button className="btn" disabled={sim.status !== 'running'} onClick={() => advance(24)}>Advance 1 day</button>}
            {live && <button className="btn" onClick={resetRun}>Reset</button>}
          </div>
          {sc && <p className="muted small">Scripted events: {sc.events.map((e) => `+${e.at} h`).join(', ')}. Same seed and clock give the same events.</p>}
        </section>

        <section className="card">
          <header><h2>Failure injection</h2><span className="muted small">needs a running run</span></header>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            {FAILURES.map((f) => (
              <div key={f.k}>
                <button className="btn" style={{ width: '100%' }} disabled={sim.status !== 'running'} onClick={() => inject(f.k)}>{f.label}</button>
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
        {sim.log.length > 0 && <p className="muted small" style={{ marginBottom: 0 }}>Resulting alerts appear in the <Link to="/risk">risk inbox</Link> once the ingestion path is connected to the backend. In this prototype the alerts are pre-seeded.</p>}
      </section>
    </div>
  )
}
