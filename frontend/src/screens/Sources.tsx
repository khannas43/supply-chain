import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useApp } from '../components/AppContext'
import { ModeBadge, PageHead, STATE_BADGE, Tabs, formatTime } from '../components/ui'
import { hoursSince, sourceState } from '../data/pipeline'
import { usePipeline } from '../data/pipelineStore'

type Tab = 'sources' | 'runs' | 'quarantine' | 'dead' | 'queue'

export function Sources() {
  const [tab, setTab] = useState<Tab>('sources')
  const { sources, runs, quarantine, dead, toggleSource, requestReplay } = usePipeline()
  const { can } = useAuth()
  const { openEvidence } = useApp()
  const [fix, setFix] = useState<Record<string, string>>({})
  const name = (id: string) => sources.find((s) => s.id === id)?.name ?? id
  const open = quarantine.filter((q) => q.status === 'quarantined').length

  return (
    <div className="page">
      <PageHead title="Source and pipeline health">
        Whether data is flowing and what is stuck. A failed or stale source shows when it last delivered usable data; it never shows as healthy, and it is not a risk disposition.
      </PageHead>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'sources', label: 'Sources' },
        { id: 'runs', label: 'Runs' },
        { id: 'quarantine', label: `Quarantine (${open})` },
        { id: 'dead', label: `Dead letter (${dead.length})` },
        { id: 'queue', label: 'Queue' },
      ]} />

      {tab === 'sources' && (
        <section className="card" style={{ padding: 0 }}><div className="table-wrap"><table>
          <thead><tr><th>Source</th><th>Mode</th><th>Last attempt</th><th>Last usable data</th><th>Policy</th><th>State</th><th /></tr></thead>
          <tbody>{sources.map((s) => {
            const st = sourceState(s)
            return (
              <tr key={s.id}>
                <td><strong>{s.name}</strong>{s.lastError && <div className="small" style={{ color: 'var(--bad)' }}>{s.lastError}</div>}</td>
                <td><ModeBadge mode={s.mode} /></td>
                <td>{formatTime(s.lastAttempt)}</td>
                <td>{formatTime(s.lastUsable)}<div className="muted small">{Math.round(hoursSince(s.lastUsable))} h ago</div></td>
                <td>{s.policyHours} h</td>
                <td><span className={`badge ${STATE_BADGE[st][0]}`}>{STATE_BADGE[st][1]}</span></td>
                <td>{can('source.toggle') && <button className="btn" onClick={() => toggleSource(s.id)}>{s.enabled ? 'Pause' : 'Enable'}</button>}</td>
              </tr>
            )
          })}</tbody>
        </table></div></section>
      )}

      {tab === 'runs' && (
        <section className="card" style={{ padding: 0 }}><div className="table-wrap"><table>
          <thead><tr><th>Run</th><th>Source</th><th>Started</th><th>Status</th><th>Accepted</th><th>Duplicate</th><th>Quarantined</th><th>Note</th></tr></thead>
          <tbody>{runs.map((r) => (
            <tr key={r.id}>
              <td className="mono">{r.id}</td><td>{name(r.sourceId)}</td><td>{formatTime(r.startedAt)}</td>
              <td><span className={`badge ${r.status === 'ok' ? 'b-ok' : r.status === 'partial' ? 'b-warn' : 'b-bad'}`}>{r.status}</span></td>
              <td>{r.accepted}</td><td>{r.duplicate}</td><td>{r.quarantined}</td><td>{r.note}</td>
            </tr>
          ))}</tbody>
        </table></div></section>
      )}

      {tab === 'quarantine' && (
        <section className="card" style={{ padding: 0 }}>
          {quarantine.length === 0 ? <div className="empty">Nothing in quarantine.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Record</th><th>Reason</th><th>Bad value</th><th>Evidence</th><th>Correction and replay</th></tr></thead>
              <tbody>{quarantine.map((q) => (
                <tr key={q.id}>
                  <td><strong className="mono">{q.id}</strong><div className="muted small">{name(q.sourceId)} · {q.sourceRow}</div></td>
                  <td>{q.reason}<div className="muted small">field: {q.field || '—'}</div></td>
                  <td className="mono">{q.badValue || <span className="muted">(empty)</span>}</td>
                  <td><button className="btn" onClick={() => openEvidence({ title: `${q.id}: ${q.reason}`, mode: 'simulated', evidence: { source: name(q.sourceId), objectKey: q.objectKey, sha256: '(computed when stored)', publishedAt: q.receivedAt, ingestedAt: q.receivedAt } })}>View</button></td>
                  <td>
                    {q.status === 'replay_requested' ? (
                      <span className="badge b-ok">Replay requested{q.correction ? `: ${q.correction}` : ''}</span>
                    ) : can('quarantine.resolve') ? (
                      <div className="row">
                        <input aria-label={`Corrected value for ${q.id}`} value={fix[q.id] ?? ''} onChange={(e) => setFix({ ...fix, [q.id]: e.target.value })} placeholder="Corrected value" />
                        <button className="btn primary" disabled={!(fix[q.id] ?? '').trim()} onClick={() => requestReplay(q.id, fix[q.id].trim())}>Replay</button>
                      </div>
                    ) : <span className="muted small">Steward or Admin only</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="muted small" style={{ padding: '0 16px' }}>Replay uses the same pipeline and the mapping version of the original run. Nothing repairs business meaning automatically.</p>
        </section>
      )}

      {tab === 'dead' && (
        <section className="card" style={{ padding: 0 }}><div className="table-wrap"><table>
          <thead><tr><th>Record</th><th>Source</th><th>Received</th><th>Reason</th><th>Attempts</th></tr></thead>
          <tbody>{dead.map((d) => (
            <tr key={d.id}><td className="mono">{d.id}</td><td>{name(d.sourceId)}</td><td>{formatTime(d.receivedAt)}</td><td>{d.reason}<div className="muted small mono">{d.objectKey}</div></td><td>{d.attempts}</td></tr>
          ))}</tbody>
        </table></div></section>
      )}

      {tab === 'queue' && (
        <section className="card">
          <header><h2>Processing queue</h2></header>
          <dl className="kv">
            <dt>Worker backlog</dt><dd>0 events waiting (demo value)</dd>
            <dt>Kafka lag</dt><dd className="muted">Not connected yet. Kafka is added after the core journey.</dd>
            <dt>NiFi</dt><dd className="muted">Not connected yet. Flow status and a link to NiFi will appear here.</dd>
          </dl>
        </section>
      )}
    </div>
  )
}
