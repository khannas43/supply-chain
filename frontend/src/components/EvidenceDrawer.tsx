import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useApp } from './AppContext'
import { ModeBadge, formatTime } from './ui'

function Original({ id }: { id: string }) {
  const [state, setState] = useState<{ body: string; sha256: string | null } | { error: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const open = async () => {
    setBusy(true)
    try {
      const r = await api.raw(`/evidence/${id}/raw`)
      let body = r.body
      try { body = JSON.stringify(JSON.parse(r.body), null, 2) } catch { /* show as received */ }
      setState({ body, sha256: r.sha256 })
    } catch (e) {
      setState({ error: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button className="btn" onClick={open} disabled={busy}>{busy ? 'Loading…' : 'View original payload'}</button>
      {state && 'error' in state && <div className="notice" role="alert" style={{ marginTop: 8 }}>{state.error}</div>}
      {state && 'body' in state && (
        <>
          <pre className="mono" style={{ maxHeight: 260, overflow: 'auto', background: 'var(--surface-2)', padding: 10, borderRadius: 6, marginBottom: 4 }}>{state.body}</pre>
          <div className="muted small">Shown exactly as collected; its SHA-256 was checked against the stored value ({state.sha256?.slice(0, 12)}…).</div>
        </>
      )}
    </div>
  )
}

export function EvidenceDrawer() {
  const { evidence, closeEvidence } = useApp()
  const { can } = useAuth()

  useEffect(() => {
    if (!evidence) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeEvidence()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [evidence, closeEvidence])

  if (!evidence) return null
  const { evidence: ev } = evidence
  const raw = can('evidence.raw')

  return (
    <>
      <div className="drawer-back" onClick={closeEvidence} />
      <aside className="drawer" role="dialog" aria-label="Evidence">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Evidence</h2>
          <button className="btn" onClick={closeEvidence}>Close</button>
        </div>
        <div>{evidence.title}</div>
        <div className="row"><ModeBadge mode={evidence.mode} />{evidence.scenarioRun && <span className="muted small">{evidence.scenarioRun}</span>}</div>
        <dl className="kv">
          <dt>Source</dt><dd>{ev.source}</dd>
          <dt>Published</dt><dd>{formatTime(ev.publishedAt)}</dd>
          <dt>Ingested</dt><dd>{formatTime(ev.ingestedAt)}</dd>
          {evidence.ruleVersion && (<><dt>Rule version</dt><dd>{evidence.ruleVersion}</dd></>)}
          <dt>Object key</dt><dd className="mono">{raw ? ev.objectKey : 'Restricted for your role'}</dd>
          <dt>SHA-256</dt><dd className="mono">{raw ? ev.sha256 : 'Restricted for your role'}</dd>
        </dl>
        {raw && ev.id && <Original key={ev.id} id={ev.id} />}
        {!raw && <div className="notice info">Your role sees evidence summaries only. Raw payload access needs Analyst, Manager, Steward or Admin.</div>}
        <div className="notice info">Simulated and replayed records stay labelled at every stage and cannot be promoted to live.</div>
      </aside>
    </>
  )
}
