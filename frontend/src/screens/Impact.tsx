import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { AlertPicker, useAssessedAlert } from '../components/AlertPicker'
import { useApp } from '../components/AppContext'
import { ModeBadge, PageHead, formatTime } from '../components/ui'
import { activeAssumption, assessmentBase, calculate } from '../data/impact'
import { options } from '../data/options'
import { useStore } from '../data/store'

const money = (n: number, c: string) => `${c} ${n.toLocaleString('en-US')}`
const num = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US')

function Unavailable({ why }: { why: string }) {
  return <span className="muted" title={why}>Unavailable <span className="small">({why})</span></span>
}

export function Impact() {
  const { alert, list, set } = useAssessedAlert()
  const { openEvidence, commodity } = useApp()
  const { user, can } = useAuth()
  const { assumptions, versions, proposeAssumption, decideAssumption } = useStore()
  const [share, setShare] = useState('')
  const [basis, setBasis] = useState('')
  const [decisionNote, setDecisionNote] = useState('')
  const [msg, setMsg] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null)

  if (!alert) {
    return (
      <div className="page">
        <PageHead title="Impact assessment">Supported business impact and the assumptions behind it.</PageHead>
        <div className="card empty">No alert for {commodity} has an assessment yet. Alerts without dependency data stay unassessed; that is not evidence of zero exposure.</div>
      </div>
    )
  }

  const base = assessmentBase[alert.id]
  const assumption = activeAssumption(assumptions, alert.id)
  const reference = options.find((o) => o.id === base.referenceOptionId)
  const calc = calculate(base, assumption, reference)
  const history = versions[alert.id] ?? []
  const current = history.slice(-1)[0]?.v ?? 1
  const why = calc.reason ?? 'Needs an approved disruption assumption.'
  const cur = base.inputs.currency
  const canDecide = can('assumption.approve') && assumption?.status === 'proposed' && assumption.proposedBy.id !== user.id

  const propose = () => {
    const n = Number(share)
    if (!(n >= 0 && n <= 100) || share.trim() === '' || !basis.trim()) {
      setMsg({ kind: 'warn', text: 'Enter an affected share between 0 and 100 and a basis.' })
      return
    }
    proposeAssumption(alert.id, n, basis.trim())
    setShare(''); setBasis(''); setMsg({ kind: 'info', text: 'Assumption proposed. A different analyst must approve it before at-risk figures appear.' })
  }
  const decide = (d: 'approved' | 'rejected') => {
    const r = decideAssumption(assumption!.id, d, decisionNote.trim())
    setMsg(r.ok ? { kind: 'info', text: d === 'approved' ? 'Approved. A new assessment version was created.' : 'Rejected.' } : { kind: 'warn', text: r.error! })
    if (r.ok) setDecisionNote('')
  }

  return (
    <div className="page">
      <PageHead title="Impact assessment">
        Only supported measures are shown. Anything that needs an input we do not have says so and names it.
      </PageHead>

      <div className="row">
        <AlertPicker list={list} value={alert.id} onChange={set} />
        <div className="row" style={{ alignSelf: 'flex-end' }}>
          <ModeBadge mode={alert.mode} />
          <span className="badge b-neutral">Assessment v{current}</span>
          <span className="muted small">{base.calcVersion}</span>
          <button className="btn" onClick={() => openEvidence({ title: alert.title, evidence: alert.evidence, mode: alert.mode, scenarioRun: alert.scenarioRun, ruleVersion: alert.ruleVersion })}>View evidence</button>
          <Link className="btn" to={`/response?alert=${alert.id}`}>Compare responses</Link>
        </div>
      </div>

      {msg && <div className={`notice ${msg.kind === 'info' ? 'info' : ''}`} role="status">{msg.text}</div>}

      <div className="grid tiles">
        <div className="tile">
          <h3>Exposed volume</h3>
          <div className="big">{num(base.exposed.value)} <span style={{ fontSize: 14 }}>{base.exposed.unit}</span></div>
          <div className="sub">over {base.exposed.horizon}, applicable demand counted once</div>
        </div>
        <div className="tile">
          <h3>At-risk volume</h3>
          <div className="big">{calc.atRisk != null ? <>{num(calc.atRisk)} <span style={{ fontSize: 14 }}>{base.exposed.unit}</span></> : '—'}</div>
          <div className="sub">{calc.atRisk != null ? `${assumption!.affectedSharePct}% affected share (approved)` : <Unavailable why={why} />}</div>
        </div>
        <div className="tile">
          <h3>Days of cover</h3>
          <div className="big">{calc.coverDays != null ? num(calc.coverDays) : '—'}</div>
          <div className="sub">{calc.coverDays != null ? `${num(base.inputs.usableStock)} ${base.inputs.stockUnit} usable ÷ ${num(base.inputs.demandPerDay)} per day` : 'Demand rate is zero or unknown'}</div>
        </div>
        <div className="tile">
          <h3>Availability gap</h3>
          <div className="big">{calc.gapDays != null ? `${num(calc.gapDays)} d` : '—'}</div>
          <div className="sub">{calc.gapDays != null ? `${reference?.name}: ${reference?.leadTimeDays} d lead time vs cover. Not a programme delay.` : <Unavailable why={why} />}</div>
        </div>
        <div className="tile">
          <h3>Incremental cost</h3>
          <div className="big">{calc.incrementalCost != null ? money(calc.incrementalCost, cur) : '—'}</div>
          <div className="sub">{calc.incrementalCost != null ? `${num(calc.atRisk!)} × (${reference?.unitPrice?.toLocaleString('en-US')} − ${base.inputs.baselinePrice.toLocaleString('en-US')}) ${cur} ${base.inputs.priceUnit}; excludes freight` : <Unavailable why={why} />}</div>
        </div>
      </div>

      <div className="grid two">
        <section className="card">
          <header><h2>Exposure paths</h2></header>
          {base.paths.map((p, i) => (
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
          <header><h2>Input snapshot</h2><span className="muted small">as of {base.inputs.asOf}</span></header>
          <dl className="kv">
            <dt>Usable stock</dt><dd>{num(base.inputs.usableStock)} {base.inputs.stockUnit}</dd>
            <dt>Demand</dt><dd>{num(base.inputs.demandPerDay)} {base.inputs.stockUnit} per day</dd>
            <dt>Baseline price</dt><dd>{money(base.inputs.baselinePrice, cur)} {base.inputs.priceUnit}</dd>
            <dt>Reference option</dt><dd>{reference?.name} ({reference?.unitPrice ? money(reference.unitPrice, cur) : 'no price'}, {reference?.leadTimeDays} d)</dd>
            <dt>Assumptions</dt><dd>{base.inputs.notes.join('; ')}</dd>
          </dl>
          <h3 style={{ marginTop: 14 }}>Missing inputs</h3>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {base.missing.map((m) => <li key={m}>{m}</li>)}
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
              <dt>Affected share</dt><dd>{assumption.affectedSharePct}% of exposed volume</dd>
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
                  <button className="btn primary" onClick={() => decide('approved')}>Approve</button>
                  <button className="btn" onClick={() => decide('rejected')}>Reject</button>
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
                <div><button className="btn" onClick={propose}>Propose and re-run</button></div>
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
              {[...history].reverse().map((v) => (
                <tr key={v.v}><td>v{v.v}{v.v === current && <span className="badge b-ok" style={{ marginLeft: 6 }}>current</span>}</td><td>{formatTime(v.at)}</td><td>{v.note}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginBottom: 0 }}>Earlier versions stay as snapshots. A new approval creates a new version; it never rewrites an old one.</p>
        </section>
      </div>
    </div>
  )
}
