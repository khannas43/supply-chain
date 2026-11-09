import { useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useApp } from './AppContext'
import { ModeBadge, formatTime } from './ui'

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
        {!raw && <div className="notice info">Your role sees evidence summaries only. Raw payload access needs Analyst, Manager, Steward or Admin.</div>}
        <div className="notice info">Simulated and replayed records stay labelled at every stage and cannot be promoted to live.</div>
      </aside>
    </>
  )
}
