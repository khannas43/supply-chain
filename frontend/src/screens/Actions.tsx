import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/hooks'
import type { ActionData, PersonData } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { useApp } from '../components/AppContext'
import { PageHead, formatTime } from '../components/ui'
import type { ActionStatus, Alert } from '../data/types'

const LABEL: Record<ActionStatus, string> = { open: 'Open', in_progress: 'In progress', review: 'In review', done: 'Done' }
const BADGE: Record<ActionStatus, string> = { open: 'b-neutral', in_progress: 'b-warn', review: 'b-warn', done: 'b-ok' }

function Detail({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const { openEvidence } = useApp()
  const { user, can } = useAuth()
  const detail = useApi<ActionData>(`/actions/${id}`)
  const alertRemote = useApi<Alert>(detail.data ? `/alerts/${detail.data.alertId}` : null)
  const [note, setNote] = useState('')
  const [next, setNext] = useState<ActionStatus>('in_progress')
  const people = useApi<PersonData[]>('/people')
  const assignable = (people.data ?? []).filter((p) => !(p.roles.length === 1 && p.roles[0] === 'demo_operator'))
  const [newOwner, setNewOwner] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const a = detail.data
  if (!a) return <div className="card empty">{detail.error ?? 'Loading…'}</div>
  const alert = alertRemote.data
  const manager = can('action.manage')
  const canUpdate = a.ownerId === user.id || can('action.update')

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      setNote('')
      detail.reload()
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="card">
        <header><h2>{a.optionName}</h2><button className="btn" onClick={onClose}>Close</button></header>
        {a.reviewNeeded && <div className="notice" style={{ marginBottom: 10 }}>The assessment is now v{a.currentAssessmentVersion}; this decision was made on v{a.assessmentVersion}. Review it. It has not been changed.</div>}
        <dl className="kv">
          <dt>Action</dt><dd>{a.id}</dd>
          <dt>Alert</dt><dd><Link to={`/risk?alert=${a.alertId}`}>{a.alertTitle}</Link></dd>
          <dt>Owner</dt><dd>{a.ownerName}</dd>
          <dt>Target date</dt><dd>{a.targetDate}{a.overdue && ' (overdue)'}</dd>
          <dt>Rationale</dt><dd>{a.rationale}</dd>
          <dt>Made on</dt><dd>Assessment v{a.assessmentVersion}, assumption {a.assumptionStatus}</dd>
          <dt>Created</dt><dd>{formatTime(a.createdAt)} by {a.createdBy}</dd>
        </dl>
        <div className="row" style={{ marginTop: 12 }}>
          {alert && <button className="btn" onClick={() => openEvidence({ title: alert.title, evidence: alert.evidence, mode: alert.mode, scenarioRun: alert.scenarioRun ?? undefined, ruleVersion: alert.ruleVersion })}>Reopen evidence</button>}
          <Link className="btn" to={`/impact?alert=${a.alertId}`}>Reopen calculation</Link>
        </div>
      </section>

      <section className="card">
        <header><h2>Update</h2></header>
        {error && <div className="notice" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
        {canUpdate || manager ? (
          <div className="field">
            {canUpdate && (
              <>
                <label htmlFor="st">New status{!manager && ' (owners can set in progress or in review)'}</label>
                <select id="st" value={next} onChange={(e) => setNext(e.target.value as ActionStatus)}>
                  {(manager ? (Object.keys(LABEL) as ActionStatus[]) : (['in_progress', 'review'] as ActionStatus[])).map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
                </select>
                <label htmlFor="nt">Note</label>
                <input id="nt" value={note} onChange={(e) => setNote(e.target.value)} />
                <div><button className="btn primary" disabled={next === a.status || busy} onClick={() => act(() => api.post(`/actions/${a.id}/status`, { status: next, note: note.trim() }))}>Update status</button></div>
              </>
            )}
            {manager && (
              <div style={{ marginTop: 10 }}>
                <label htmlFor="ro">Reassign owner</label>
                <div className="row">
                  <select id="ro" value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
                    <option value="">Choose a person</option>{assignable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button className="btn" disabled={!newOwner || newOwner === a.ownerId || busy} onClick={() => act(() => api.post(`/actions/${a.id}/reassign`, { ownerId: newOwner, ownerName: assignable.find((p) => p.id === newOwner)!.name, note: note.trim() }))}>Reassign</button>
                </div>
                {a.status === 'done' && <div style={{ marginTop: 8 }}><button className="btn" disabled={busy} onClick={() => act(() => api.post(`/actions/${a.id}/status`, { status: 'in_progress', note: note.trim() || 'Reopened' }))}>Reopen action</button></div>}
              </div>
            )}
          </div>
        ) : <div className="muted">Only the owner or a Procurement Manager can update this action.</div>}
      </section>

      <section className="card">
        <header><h2>History</h2></header>
        {[...a.history].reverse().map((h, i) => (
          <div key={i} style={{ marginBottom: 8 }}>
            <div><span className={`badge ${BADGE[h.to]}`}>{LABEL[h.to]}</span> <span className="muted small">{formatTime(h.at)} · {h.actor}</span></div>
            {h.note && <div className="small">{h.note}</div>}
          </div>
        ))}
        {a.audit.length > 0 && <><h3 style={{ marginTop: 10 }}>Audit trail</h3>{a.audit.map((e, i) => <div key={i} className="small muted">{formatTime(e.at)} · {e.actor} · {e.event} · {e.detail}</div>)}</>}
      </section>
    </>
  )
}

export function Actions() {
  const { commodity } = useApp()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState<'all' | ActionStatus>('all')
  const [owner, setOwner] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const directory = useApi<PersonData[]>('/people')

  const query = [`commodity=${commodity}`, status !== 'all' && `status=${status}`, owner !== 'all' && `ownerId=${owner}`, overdueOnly && 'overdueOnly=true'].filter(Boolean).join('&')
  const list = useApi<ActionData[]>(`/actions?${query}`)
  const rows = list.data ?? []
  const selId = params.get('action')
  const choose = (id: string | null) => setParams(id ? { action: id } : {})

  return (
    <div className="page">
      <PageHead title="Action register">
        What was decided, who owns it and where it stands. A recalculation can flag an action for review, but it never changes a decision on its own.
      </PageHead>

      <div className="row">
        <div className="field"><label htmlFor="a-st">Status</label>
          <select id="a-st" value={status} onChange={(e) => setStatus(e.target.value as 'all' | ActionStatus)}>
            <option value="all">All</option>{(Object.keys(LABEL) as ActionStatus[]).map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
          </select></div>
        <div className="field"><label htmlFor="a-ow">Owner</label>
          <select id="a-ow" value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">All</option>{(directory.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <label className="row" style={{ alignSelf: 'flex-end' }}><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only</label>
      </div>

      {list.error && <div className="notice" role="alert">{list.error} <button className="btn" onClick={list.reload}>Retry</button></div>}

      <div className="split">
        <section className="card" style={{ padding: 0 }}>
          {list.data === null ? (
            !list.error && <div className="empty" role="status">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="empty">No actions match. Decisions are recorded from the <Link to="/response">response comparison</Link>.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Action</th><th>Owner</th><th>Target</th><th>Status</th><th>Flags</th></tr></thead>
                <tbody>
                  {rows.map((a) => (
                    <tr key={a.id} className={`clickable ${a.id === selId ? 'sel' : ''}`} tabIndex={0} aria-selected={a.id === selId}
                      onClick={() => choose(a.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), choose(a.id))}>
                      <td><strong>{a.optionName}</strong><div className="muted small">{a.id} · {a.alertId}</div></td>
                      <td>{a.ownerName}</td>
                      <td>{a.targetDate}</td>
                      <td><span className={`badge ${BADGE[a.status]}`}>{LABEL[a.status]}</span></td>
                      <td><div className="row">{a.overdue && <span className="badge b-bad">Overdue</span>}{a.reviewNeeded && <span className="badge b-warn">Review needed</span>}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="detail" aria-live="polite">
          {!selId ? <div className="card empty">Select an action to see its history, evidence and audit trail.</div> : (
            <Detail key={selId} id={selId} onChanged={list.reload} onClose={() => choose(null)} />
          )}
        </aside>
      </div>
    </div>
  )
}
