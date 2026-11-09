import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/hooks'
import type { AssessmentData } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { AlertPicker, useAssessedAlert } from '../components/AlertPicker'
import { useApp } from '../components/AppContext'
import { ModeBadge, PageHead, formatTime } from '../components/ui'
import type { Alert } from '../data/types'

const money = (n: number, c: string) => `${c} ${n.toLocaleString('en-US')}`
const num = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US')

function Unavailable({ why }: { why: string }) {
  return <span className="muted" title={why}>Unavailable <span className="small">({why})</span></span>
}

function Body({ alert, a, reload }: { alert: Alert; a: AssessmentData; reload: () => void }) {
  const { openEvidence } = useApp()
  const { user, can } = useAuth()
  const [share, setShare] = useState('')
  const [basis, setBasis] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null)

  const { calc, inputs, referenceOption: reference, assumption } = a
  const why = calc.reason ?? 'Needs an approved disruption assumption.'
  const cur = inputs.currency
  const canDecide = can('assumption.approve') && assumption?.status === 'proposed' && assumption.proposedBy.id !== user.id

  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true)
    try {
      await work()
      setMsg({ kind: 'info', text: success })
      reload()
      return true
    } catch (e) {
      setMsg({ kind: 'warn', text: (e as Error).message })
      return false
    } finally {
      setBusy(false)
    }
  }

  const propose = async () => {
    const n = Number(share)
    if (!(n >= 0 && n <= 100) || share.trim() === '' || !basis.trim()) {
      setMsg({ kind: 'warn', text: 'Enter an affected share between 0 and 100 and a basis.' })
      return
    }
    const ok = await run(
      () => api.post(`/alerts/${alert.id}/assumptions`, { affectedSharePct: n, basis: basis.trim() }),
      'Assumption proposed. A different analyst must approve it before at-risk figures appear.',
    )
    if (ok) { setShare(''); setBasis('') }
  }

  const decide = async (decision: 'approved' | 'rejected') => {
    const ok = await run(
      () => api.post(`/assumptions/${assumption!.id}/decision`, { decision, note: decisionNote.trim() }),
      decision === 'approved' ? 'Approved. A new assessment version was created.' : 'Rejected.',
    )
    if (ok) setDecisionNote('')
  }

  return (
    <>
      <div className="row">
        <div className="row" style={{ alignSelf: 'flex-end' }}>
          <ModeBadge mode={alert.mode} />
          <span className="badge b-neutral">Assessment v{a.version}</span>
          <span className="muted small">{a.calcVersion}</span>
          <button className="btn" onClick={() => openEvidence({ title: alert.title, evidence: alert.evidence, mode: alert.mode, scenarioRun: alert.scenarioRun ?? undefined, ruleVersion: alert.ruleVersion })}>View evidence</button>
          <Link className="btn" to={`/response?alert=${alert.id}`}>Compare responses</Link>
        </div>
      </div>

      {msg && <div className={`notice ${msg.kind === 'info' ? 'info' : ''}`} role="status">{msg.text}</div>}

      <div className="grid tiles">
        <div className="tile">
          <h3>Exposed volume</h3>
          <div className="big">{num(a.exposed.value)} <span style={{ fontSize: 14 }}>{a.exposed.unit}</span></div>
          <div className="sub">over {a.exposed.horizon}, applicable demand counted once</div>
        </div>
        <div className="tile">
          <h3>At-risk volume</h3>
          <div className="big">{calc.atRisk != null ? <>{num(calc.atRisk)} <span style={{ fontSize: 14 }}>{a.exposed.unit}</span></> : '—'}</div>
          <div className="sub">{calc.atRisk != null ? `${num(assumption!.affectedSharePct)}% affected share (approved)` : <Unavailable why={why} />}</div>
        </div>
        <div className="tile">
          <h3>Days of cover</h3>
          <div className="big">{calc.coverDays != null ? num(calc.coverDays) : '—'}</div>
          <div className="sub">{calc.coverDays != null ? `${num(inputs.usableStock)} ${inputs.stockUnit} usable ÷ ${num(inputs.demandPerDay)} per day` : 'Demand rate is zero or unknown'}</div>
        </div>
        <div className="tile">
          <h3>Availability gap</h3>
          <div className="big">{calc.gapDays != null ? `${num(calc.gapDays)} d` : '—'}</div>
          <div className="sub">{calc.gapDays != null ? `${reference.name}: ${reference.leadTimeDays} d lead time vs cover. Not a programme delay.` : <Unavailable why={why} />}</div>
        </div>
        <div className="tile">
          <h3>Incremental cost</h3>
          <div className="big">{calc.incrementalCost != null ? money(calc.incrementalCost, cur) : '—'}</div>
          <div className="sub">{calc.incrementalCost != null ? `${num(calc.atRisk!)} × (${reference.unitPrice?.toLocaleString('en-US')} − ${inputs.baselinePrice.toLocaleString('en-US')}) ${cur} ${inputs.priceUnit}; excludes freight` : <Unavailable why={why} />}</div>
        </div>
      </div>

      <div className="grid two">
        <section className="card">
          <header><h2>Exposure paths</h2></header>
          {a.paths.map((p, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div className="row">
                <span className={`badge ${p.classification === 'confirmed' ? 'b-bad' : p.classification === 'potential' ? 'b-warn' : 'b-neutral'}`}>{p.classification}</span>
                <span>{p.nodes.join(' → ')}</span>
              </div>
              <div className="muted small">{p.basis}</div>
            </div>
          ))}
          <p className="muted small" style={{ marginBottom: 0 }}>Geographic overlap is a candidate exposure, not proof of interruption. Unknown allocations stay unknown.</p>
          <Link className="small" to={`/network?focus=${alert.exposedNodeIds[0]}&alert=${alert.id}`}>Open in supplier network</Link>
        </section>

        <section className="card">
          <header><h2>Input snapshot</h2><span className="muted small">as of {inputs.asOf}</span></header>
          <dl className="kv">
            <dt>Usable stock</dt><dd>{num(inputs.usableStock)} {inputs.stockUnit}</dd>
            <dt>Demand</dt><dd>{num(inputs.demandPerDay)} {inputs.stockUnit} per day</dd>
            <dt>Baseline price</dt><dd>{money(inputs.baselinePrice, cur)} {inputs.priceUnit}</dd>
            <dt>Reference option</dt><dd>{reference.name} ({reference.unitPrice ? money(reference.unitPrice, cur) : 'no price'}, {reference.leadTimeDays} d)</dd>
            <dt>Assumptions</dt><dd>{inputs.notes.join('; ')}</dd>
          </dl>
          <h3 style={{ marginTop: 14 }}>Missing inputs</h3>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {a.missing.map((m) => <li key={m}>{m}</li>)}
          </ul>
        </section>
      </div>

      <div className="grid two">
        <section className="card">
          <header><h2>Disruption assumption</h2>
            {assumption && <span className={`badge ${assumption.status === 'approved' ? 'b-ok' : assumption.status === 'rejected' ? 'b-bad' : 'b-warn'}`}>{assumption.status}</span>}
          </header>
          {assumption ? (
            <dl className="kv">
              <dt>Affected share</dt><dd>{num(assumption.affectedSharePct)}% of exposed volume</dd>
              <dt>Basis</dt><dd>{assumption.basis}</dd>
              <dt>Proposed by</dt><dd>{assumption.proposedBy.name}, {formatTime(assumption.proposedAt)}</dd>
              {assumption.decidedBy && (<><dt>Decided by</dt><dd>{assumption.decidedBy.name}, {formatTime(assumption.decidedAt!)}{assumption.decisionNote ? ` — ${assumption.decisionNote}` : ''}</dd></>)}
            </dl>
          ) : <div className="muted">No assumption yet.</div>}

          {assumption?.status === 'proposed' && can('assumption.approve') && (
            assumption.proposedBy.id === user.id ? (
              <div className="notice info" style={{ marginTop: 10 }}>You proposed this assumption. A different analyst must approve or reject it.</div>
            ) : canDecide && (
              <div className="field" style={{ marginTop: 10 }}>
                <label htmlFor="dn">Decision note</label>
                <input id="dn" value={decisionNote} onChange={(e) => setDecisionNote(e.target.value)} />
                <div className="row">
                  <button className="btn primary" disabled={busy} onClick={() => decide('approved')}>Approve</button>
                  <button className="btn" disabled={busy} onClick={() => decide('rejected')}>Reject</button>
                </div>
              </div>
            )
          )}

          {can('assumption.propose') ? (
            <div style={{ marginTop: 14 }}>
              <h3>Propose a new assumption</h3>
              <div className="field" style={{ marginTop: 6 }}>
                <label htmlFor="sh">Affected share of exposed volume (%)</label>
                <input id="sh" type="number" min={0} max={100} value={share} onChange={(e) => setShare(e.target.value)} />
                <label htmlFor="ba">Basis</label>
                <textarea id="ba" value={basis} onChange={(e) => setBasis(e.target.value)} />
                <div><button className="btn" disabled={busy} onClick={propose}>Propose and re-run</button></div>
              </div>
              <p className="muted small">Proposing replaces the current assumption. At-risk figures stay unavailable until another analyst approves.</p>
            </div>
          ) : <p className="muted small" style={{ marginTop: 12 }}>Only a Risk Analyst can propose or approve assumptions.</p>}
        </section>

        <section className="card">
          <header><h2>Assessment versions</h2></header>
          <table>
            <thead><tr><th>Version</th><th>When</th><th>Change</th></tr></thead>
            <tbody>
              {[...a.versions].reverse().map((v) => (
                <tr key={v.v}><td>v{v.v}{v.v === a.version && <span className="badge b-ok" style={{ marginLeft: 6 }}>current</span>}</td><td>{formatTime(v.at)}</td><td>{v.note}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginBottom: 0 }}>Earlier versions stay as snapshots. A new approval creates a new version; it never rewrites an old one.</p>
        </section>
      </div>
    </>
  )
}

export function Impact() {
  const { alert, list, set, remote } = useAssessedAlert()
  const { commodity } = useApp()
  const assessment = useApi<AssessmentData>(alert ? `/alerts/${alert.id}/assessment` : null)
  const error = remote.error ?? assessment.error
  const ready = alert && assessment.data?.alertId === alert.id
  const loadedList = remote.data !== null

  return (
    <div className="page">
      <PageHead title="Impact assessment">
        Only supported measures are shown. Anything that needs an input we do not have says so and names it.
      </PageHead>
      {error && <div className="notice" role="alert">{error} <button className="btn" onClick={() => { remote.reload(); assessment.reload() }}>Retry</button></div>}
      {loadedList && !alert && (
        <div className="card empty">No alert for {commodity} has an assessment yet. Alerts without dependency data stay unassessed; that is not evidence of zero exposure.</div>
      )}
      {alert && (
        <>
          <div className="row"><AlertPicker list={list} value={alert.id} onChange={set} /></div>
          {ready ? <Body alert={alert} a={assessment.data!} reload={() => { assessment.reload(); remote.reload() }} /> : !error && <div className="empty" role="status">Loading…</div>}
        </>
      )}
      {!loadedList && !error && <div className="empty" role="status">Loading…</div>}
    </div>
  )
}
