import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { IDENTITIES } from '../auth/users'
import { useApp } from '../components/AppContext'
import { PageHead, formatTime } from '../components/ui'
import { TODAY, useStore } from '../data/store'
import type { ActionItem, ActionStatus } from '../data/types'

const LABEL: Record<ActionStatus, string> = { open: 'Open', in_progress: 'In progress', review: 'In review', done: 'Done' }
const BADGE: Record<ActionStatus, string> = { open: 'b-neutral', in_progress: 'b-warn', review: 'b-warn', done: 'b-ok' }

export function Actions() {
  const { commodity, openEvidence } = useApp()
  const { user, can } = useAuth()
  const { actions, alerts, currentVersion, updateStatus, reassign, audit } = useStore()
  const [params, setParams] = useSearchParams()
  const [status, setStatus] = useState<'all' | ActionStatus>('all')
  const [owner, setOwner] = useState('all')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [note, setNote] = useState('')
  const [next, setNext] = useState<ActionStatus>('in_progress')
  const [newOwner, setNewOwner] = useState('u-manager')

  const overdue = (a: ActionItem) => a.status !== 'done' && a.targetDate < TODAY
  const needsReview = (a: ActionItem) => a.status !== 'done' && a.assessmentVersion < currentVersion(a.alertId)

  const rows = useMemo(
    () =>
      actions
        .filter((a) => a.commodity === commodity)
        .filter((a) => status === 'all' || a.status === status)
        .filter((a) => owner === 'all' || a.ownerId === owner)
        .filter((a) => !overdueOnly || (a.status !== 'done' && a.targetDate < TODAY))
        .sort((a, b) => a.targetDate.localeCompare(b.targetDate)),
    [actions, commodity, status, owner, overdueOnly],
  )

  const selId = params.get('action')
  const sel = actions.find((a) => a.id === selId && a.commodity === commodity) ?? null
  const alert = sel ? alerts.find((a) => a.id === sel.alertId) : undefined
  const isOwner = !!sel && sel.ownerId === user.id
  const canUpdate = !!sel && (isOwner || can('action.update'))
  const canManage = can('action.manage')
  const choose = (id: string | null) => { setNote(''); setParams(id ? { action: id } : {}) }
  const auditFor = sel ? audit.filter((e) => e.ref === sel.id) : []

  const apply = () => {
    if (!sel) return
    updateStatus(sel.id, next, note.trim())
    setNote('')
  }

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
            <option value="all">All</option>{IDENTITIES.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select></div>
        <label className="row" style={{ alignSelf: 'flex-end' }}><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Overdue only</label>
      </div>

      <div className="split">
        <section className="card" style={{ padding: 0 }}>
          {rows.length === 0 ? (
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
                      <td><div className="row">{overdue(a) && <span className="badge b-bad">Overdue</span>}{needsReview(a) && <span className="badge b-warn">Review needed</span>}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="detail" aria-live="polite">
          {!sel ? <div className="card empty">Select an action to see its history, evidence and audit trail.</div> : (
            <>
              <section className="card">
                <header><h2>{sel.optionName}</h2><button className="btn" onClick={() => choose(null)}>Close</button></header>
                {needsReview(sel) && <div className="notice" style={{ marginBottom: 10 }}>The assessment is now v{currentVersion(sel.alertId)}; this decision was made on v{sel.assessmentVersion}. Review it. It has not been changed.</div>}
                <dl className="kv">
                  <dt>Action</dt><dd>{sel.id}</dd>
                  <dt>Alert</dt><dd><Link to={`/risk?alert=${sel.alertId}`}>{alert?.title ?? sel.alertId}</Link></dd>
                  <dt>Owner</dt><dd>{sel.ownerName}</dd>
                  <dt>Target date</dt><dd>{sel.targetDate}{overdue(sel) && ' (overdue)'}</dd>
                  <dt>Rationale</dt><dd>{sel.rationale}</dd>
                  <dt>Made on</dt><dd>Assessment v{sel.assessmentVersion}, assumption {sel.assumptionStatus}</dd>
                  <dt>Created</dt><dd>{formatTime(sel.createdAt)} by {sel.createdBy}</dd>
                </dl>
                <div className="row" style={{ marginTop: 12 }}>
                  {alert && <button className="btn" onClick={() => openEvidence({ title: alert.title, evidence: alert.evidence, mode: alert.mode, scenarioRun: alert.scenarioRun, ruleVersion: alert.ruleVersion })}>Reopen evidence</button>}
                  <Link className="btn" to={`/impact?alert=${sel.alertId}`}>Reopen calculation</Link>
                </div>
              </section>

              <section className="card">
                <header><h2>Update</h2></header>
                {canUpdate || canManage ? (
                  <div className="field">
                    {canUpdate && (
                      <>
                        <label htmlFor="st">New status{!canManage && ' (owners can set in progress or in review)'}</label>
                        <select id="st" value={next} onChange={(e) => setNext(e.target.value as ActionStatus)}>
                          {(canManage ? (Object.keys(LABEL) as ActionStatus[]) : (['in_progress', 'review'] as ActionStatus[])).map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
                        </select>
                        <label htmlFor="nt">Note</label>
                        <input id="nt" value={note} onChange={(e) => setNote(e.target.value)} />
                        <div><button className="btn primary" onClick={apply} disabled={next === sel.status}>Update status</button></div>
                      </>
                    )}
                    {canManage && (
                      <div style={{ marginTop: 10 }}>
                        <label htmlFor="ro">Reassign owner</label>
                        <div className="row">
                          <select id="ro" value={newOwner} onChange={(e) => setNewOwner(e.target.value)}>
                            {IDENTITIES.filter((i) => i.role !== 'demo_operator').map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                          </select>
                          <button className="btn" onClick={() => reassign(sel.id, newOwner, note.trim())} disabled={newOwner === sel.ownerId}>Reassign</button>
                        </div>
                        {sel.status === 'done' && <div style={{ marginTop: 8 }}><button className="btn" onClick={() => updateStatus(sel.id, 'in_progress', note.trim() || 'Reopened')}>Reopen action</button></div>}
                      </div>
                    )}
                  </div>
                ) : <div className="muted">Only the owner or a Procurement Manager can update this action.</div>}
              </section>

              <section className="card">
                <header><h2>History</h2></header>
                {[...sel.history].reverse().map((h, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div><span className={`badge ${BADGE[h.to]}`}>{LABEL[h.to]}</span> <span className="muted small">{formatTime(h.at)} · {h.actor}</span></div>
                    {h.note && <div className="small">{h.note}</div>}
                  </div>
                ))}
                {auditFor.length > 0 && <><h3 style={{ marginTop: 10 }}>Audit trail</h3>{auditFor.map((e, i) => <div key={i} className="small muted">{formatTime(e.at)} · {e.actor} · {e.event} · {e.detail}</div>)}</>}
              </section>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
