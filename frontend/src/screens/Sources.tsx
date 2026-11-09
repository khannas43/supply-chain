import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/hooks'
import type { DeadData, QuarantineData, QueueData, RunData, SourceHealth } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useApp } from '../components/AppContext'
import { ModeBadge, PageHead, STATE_BADGE, Tabs, formatTime } from '../components/ui'

type Tab = 'sources' | 'runs' | 'quarantine' | 'dead' | 'queue'

export function Sources() {
  const [tab, setTab] = useState<Tab>('sources')
  const { can } = useAuth()
  const { openEvidence } = useApp()
  const sources = useApi<SourceHealth[]>('/sources')
  const runs = useApi<RunData[]>('/runs')
  const quarantine = useApi<QuarantineData[]>('/quarantine')
  const dead = useApi<DeadData[]>('/dead-letter')
  const queue = useApi<QueueData>(tab === 'queue' ? '/pipeline/queue' : null)
  const [fix, setFix] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const name = (id: string) => sources.data?.find((s) => s.id === id)?.name ?? id
  const open = (quarantine.data ?? []).filter((q) => q.status === 'quarantined').length
  const failure = sources.error ?? runs.error ?? quarantine.error ?? dead.error ?? queue.error

  const act = async (work: () => Promise<unknown>, after: () => void) => {
    setError(null)
    try {
      await work()
      after()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="page">
      <PageHead title="Source and pipeline health">
        Whether data is flowing and what is stuck. A failed or stale source shows when it last delivered usable data; it never shows as healthy, and it is not a risk disposition.
      </PageHead>
      {(failure || error) && (
        <div className="notice" role="alert">{error ?? failure} <button className="btn" onClick={() => { sources.reload(); runs.reload(); quarantine.reload(); dead.reload() }}>Retry</button></div>
      )}
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'sources', label: 'Sources' },
        { id: 'runs', label: 'Runs' },
        { id: 'quarantine', label: `Quarantine (${open})` },
        { id: 'dead', label: `Dead letter (${dead.data?.length ?? 0})` },
        { id: 'queue', label: 'Queue' },
      ]} />

      {tab === 'sources' && (
        <section className="card" style={{ padding: 0 }}>
          {sources.data === null ? <div className="empty" role="status">Loading…</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Source</th><th>Mode</th><th>Last attempt</th><th>Last usable data</th><th>Policy</th><th>State</th><th /></tr></thead>
              <tbody>{sources.data.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong>{s.lastError && <div className="small" style={{ color: 'var(--bad)' }}>{s.lastError}</div>}</td>
                  <td><ModeBadge mode={s.mode} /></td>
                  <td>{s.lastAttempt ? formatTime(s.lastAttempt) : '—'}</td>
                  <td>{s.lastUsable ? formatTime(s.lastUsable) : 'never'}{s.hoursSinceUsable != null && <div className="muted small">{Math.round(s.hoursSinceUsable)} h ago</div>}</td>
                  <td>{s.policyHours} h</td>
                  <td><span className={`badge ${STATE_BADGE[s.state][0]}`}>{STATE_BADGE[s.state][1]}</span></td>
                  <td>{can('source.toggle') && <button className="btn" onClick={() => act(() => api.post(`/sources/${s.id}/enabled`, { enabled: !s.enabled }), sources.reload)}>{s.enabled ? 'Pause' : 'Enable'}</button>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === 'runs' && (
        <section className="card" style={{ padding: 0 }}>
          {runs.data === null ? <div className="empty" role="status">Loading…</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Run</th><th>Source</th><th>Started</th><th>Status</th><th>Accepted</th><th>Duplicate</th><th>Quarantined</th><th>Note</th></tr></thead>
              <tbody>{runs.data.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td><td>{name(r.sourceId)}</td><td>{formatTime(r.startedAt)}</td>
                  <td><span className={`badge ${r.status === 'ok' ? 'b-ok' : r.status === 'partial' ? 'b-warn' : 'b-bad'}`}>{r.status}</span></td>
                  <td>{r.accepted}</td><td>{r.duplicate}</td><td>{r.quarantined}</td><td>{r.note}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === 'quarantine' && (
        <section className="card" style={{ padding: 0 }}>
          {quarantine.data === null ? <div className="empty" role="status">Loading…</div> : quarantine.data.length === 0 ? <div className="empty">Nothing in quarantine.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Record</th><th>Reason</th><th>Bad value</th><th>Evidence</th><th>Correction and replay</th></tr></thead>
              <tbody>{quarantine.data.map((q) => (
                <tr key={q.id}>
                  <td><strong className="mono">{q.id}</strong><div className="muted small">{q.sourceName} · {q.sourceRow}</div></td>
                  <td>{q.reason}<div className="muted small">field: {q.field || '—'}</div></td>
                  <td className="mono">{q.badValue || <span className="muted">(empty)</span>}</td>
                  <td><button className="btn" onClick={() => openEvidence({ title: `${q.id}: ${q.reason}`, mode: 'simulated', evidence: { source: q.sourceName, objectKey: q.objectKey, sha256: '(computed when stored)', publishedAt: q.receivedAt, ingestedAt: q.receivedAt } })}>View</button></td>
                  <td>
                    {q.status === 'replay_requested' ? (
                      <span className="badge b-ok">Replay requested{q.correction ? `: ${q.correction}` : ''}</span>
                    ) : can('quarantine.resolve') ? (
                      <div className="row">
                        <input aria-label={`Corrected value for ${q.id}`} value={fix[q.id] ?? ''} onChange={(e) => setFix({ ...fix, [q.id]: e.target.value })} placeholder="Corrected value" />
                        <button className="btn primary" disabled={!(fix[q.id] ?? '').trim()} onClick={() => act(() => api.post(`/quarantine/${q.id}/replay`, { correction: fix[q.id].trim() }), quarantine.reload)}>Replay</button>
                      </div>
                    ) : <span className="muted small">Steward or Admin only</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <p className="muted small" style={{ padding: '0 16px' }}>A replay request saves the corrected value. The replay runs through the same pipeline once ingestion is connected. Nothing repairs business meaning automatically.</p>
        </section>
      )}

      {tab === 'dead' && (
        <section className="card" style={{ padding: 0 }}>
          {dead.data === null ? <div className="empty" role="status">Loading…</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Record</th><th>Source</th><th>Received</th><th>Reason</th><th>Attempts</th></tr></thead>
              <tbody>{dead.data.map((d) => (
                <tr key={d.id}><td className="mono">{d.id}</td><td>{d.sourceName}</td><td>{formatTime(d.receivedAt)}</td><td>{d.reason}<div className="muted small mono">{d.objectKey}</div></td><td>{d.attempts}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </section>
      )}

      {tab === 'queue' && (
        <section className="card">
          <header><h2>Processing queue</h2></header>
          {queue.data === null ? <div className="muted" role="status">Loading…</div> : (
            <dl className="kv">
              <dt>Worker backlog</dt><dd>{queue.data.workerBacklog} events waiting</dd>
              <dt>Kafka lag</dt><dd className={queue.data.kafka === 'connected' ? '' : 'muted'}>{queue.data.kafka === 'connected' ? 'Connected' : 'Not connected yet. Kafka is added after the core journey.'}</dd>
              <dt>NiFi</dt><dd className={queue.data.nifi === 'connected' ? '' : 'muted'}>{queue.data.nifi === 'connected' ? 'Connected' : 'Not connected yet. Flow status and a link to NiFi will appear here.'}</dd>
            </dl>
          )}
        </section>
      )}
    </div>
  )
}
