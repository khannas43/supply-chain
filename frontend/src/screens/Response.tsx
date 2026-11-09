import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { IDENTITIES } from '../auth/users'
import { AlertPicker, useAssessedAlert } from '../components/AlertPicker'
import { PageHead } from '../components/ui'
import { activeAssumption, assessmentBase, calculate } from '../data/impact'
import { options } from '../data/options'
import { NOW } from '../data/mock'
import { TODAY, useStore } from '../data/store'
import type { ResponseOption } from '../data/types'

const num = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US')
const daysUntil = (d: string) => Math.round((Date.parse(d) - Date.parse(NOW)) / 86400000)

function eligibility(o: ResponseOption): string | null {
  if (o.qualification === 'unknown') return 'Qualification not on file. Unknown qualification is not approved.'
  if (o.qualification === 'expired') return 'Qualification expired.'
  if (o.specFit === 'unknown') return 'Specification fit unknown.'
  if (o.specFit === 'partial') return 'Specification only partly met.'
  if (o.quoteValidUntil && o.quoteValidUntil < TODAY) return `Quote expired on ${o.quoteValidUntil}.`
  return null
}

export function Response() {
  const { alert, list, set } = useAssessedAlert()
  const { can, user } = useAuth()
  const { assumptions, shortlist, toggleShortlist, createAction } = useStore()
  const nav = useNavigate()
  const [selecting, setSelecting] = useState<ResponseOption | null>(null)
  const [owner, setOwner] = useState('u-manager')
  const [target, setTarget] = useState('')
  const [why, setWhy] = useState('')

  if (!alert) {
    return (
      <div className="page">
        <PageHead title="Response comparison">Compare qualified alternatives and response options.</PageHead>
        <div className="card empty">No assessed alert for this commodity yet.</div>
      </div>
    )
  }

  const base = assessmentBase[alert.id]
  const assumption = activeAssumption(assumptions, alert.id)
  const mine = options.filter((o) => o.alertId === alert.id)
  const reference = options.find((o) => o.id === base.referenceOptionId)
  const cover = calculate(base, assumption, reference).coverDays
  const cur = base.inputs.currency

  const metrics = (o: ResponseOption) => {
    const c = calculate(base, assumption, o)
    return { gap: c.gapDays, cost: c.incrementalCost }
  }
  const eligible = mine.filter((o) => !eligibility(o))
  const ranked = eligible
    .filter((o) => o.type !== 'inventory')
    .map((o) => ({ o, ...metrics(o) }))
    .sort((a, b) => (a.gap ?? Infinity) - (b.gap ?? Infinity) || (a.cost ?? Infinity) - (b.cost ?? Infinity) || a.o.leadTimeDays - b.o.leadTimeDays)
  const complementary = eligible.filter((o) => o.type === 'inventory')
  const ineligible = mine.filter((o) => eligibility(o))

  const quoteFlag = (o: ResponseOption) => {
    if (!o.quoteValidUntil) return null
    const d = daysUntil(o.quoteValidUntil)
    if (d < 0) return <span className="badge b-bad">Quote expired</span>
    if (d <= 14) return <span className="badge b-warn">Expires in {d} d</span>
    return <span className="muted small">valid to {o.quoteValidUntil}</span>
  }

  const confirm = () => {
    if (!selecting || !target || !why.trim()) return
    const id = createAction(selecting, { ownerId: owner, targetDate: target, rationale: why.trim() })
    nav(`/actions?action=${id}`)
  }

  const row = (o: ResponseOption, rank?: number, m?: { gap: number | null; cost: number | null }) => {
    const listed = shortlist.includes(o.id)
    return (
      <tr key={o.id}>
        <td>{rank ?? '—'}</td>
        <td><strong>{o.name}</strong><div className="row"><span className="badge b-neutral">{o.type}</span>{listed && <span className="badge b-ok">Shortlisted</span>}</div><div className="muted small">{o.note}</div></td>
        <td><span className="badge b-ok">{o.qualification}</span> <span className="badge b-neutral">spec {o.specFit}</span></td>
        <td>{o.capacity}</td>
        <td>{o.unitPrice != null ? `${cur} ${o.unitPrice.toLocaleString('en-US')}` : '—'}</td>
        <td>{o.leadTimeDays} d</td>
        <td>{quoteFlag(o)}</td>
        <td>
          {o.type === 'inventory'
            ? <>+{num((o.quantityAvailable ?? 0) / base.inputs.demandPerDay)} d cover<div className="muted small">excludes handling cost</div></>
            : <>Gap: {m?.gap != null ? `${num(m.gap)} d` : <span className="muted">unavailable</span>}<br />Cost: {m?.cost != null ? `${cur} ${m.cost.toLocaleString('en-US')}` : <span className="muted">unavailable</span>}</>}
        </td>
        <td>
          <div className="row">
            {can('option.shortlist') && <button className="btn" onClick={() => toggleShortlist(o.id)}>{listed ? 'Remove' : 'Shortlist'}</button>}
            {can('decision.create') && <button className="btn primary" onClick={() => { setSelecting(o); setOwner('u-manager') }}>Select</button>}
          </div>
        </td>
      </tr>
    )
  }

  const head = <thead><tr><th>Rank</th><th>Option</th><th>Qualification</th><th>Capacity</th><th>Unit price</th><th>Lead time</th><th>Quote</th><th>Effect</th><th /></tr></thead>

  return (
    <div className="page">
      <PageHead title="Response comparison">
        Options are filtered by qualification and specification before they are ranked. Recommendations are confirmed by a person; nothing here places an order, and capacity and commercial terms are not verified.
      </PageHead>

      <div className="row"><AlertPicker list={list} value={alert.id} onChange={set} /></div>

      <div className="notice info">
        Days of cover {cover != null ? num(cover) : 'unknown'}. Assumption status: <strong>{assumption?.status ?? 'none'}</strong>.
        {assumption?.status !== 'approved' && ' Gap and cost stay unavailable until an approved disruption assumption exists.'}
      </div>

      <section className="card" style={{ padding: 0 }}>
        <header style={{ padding: '12px 16px 0' }}><h2>Ranked options</h2><span className="muted small">by availability gap, then cost, then lead time</span></header>
        {ranked.length === 0 ? <div className="empty">No eligible sourcing or logistics option.</div> : (
          <div className="table-wrap"><table>{head}<tbody>{ranked.map((r, i) => row(r.o, i + 1, r))}</tbody></table></div>
        )}
      </section>

      {complementary.length > 0 && (
        <section className="card" style={{ padding: 0 }}>
          <header style={{ padding: '12px 16px 0' }}><h2>Complementary: inventory</h2><span className="muted small">extends cover, not ranked against sourcing</span></header>
          <div className="table-wrap"><table>{head}<tbody>{complementary.map((o) => row(o))}</tbody></table></div>
        </section>
      )}

      {ineligible.length > 0 && (
        <section className="card">
          <header><h2>Not eligible</h2></header>
          {ineligible.map((o) => (
            <div key={o.id} style={{ marginBottom: 8 }}>
              <strong>{o.name}</strong> <span className="badge b-neutral">{o.type}</span>
              <div className="muted small">{eligibility(o)}</div>
            </div>
          ))}
        </section>
      )}

      {selecting && (
        <section className="card" aria-label="Record decision">
          <header><h2>Record decision: {selecting.name}</h2><button className="btn" onClick={() => setSelecting(null)}>Cancel</button></header>
          {assumption?.status !== 'approved' && <div className="notice" style={{ marginBottom: 10 }}>This decision rests on an assumption that is {assumption?.status ?? 'missing'}. It will be flagged for review if the assessment changes.</div>}
          <div className="grid two">
            <div className="field"><label htmlFor="own">Owner</label>
              <select id="own" value={owner} onChange={(e) => setOwner(e.target.value)}>
                {IDENTITIES.filter((i) => i.role !== 'demo_operator').map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="tgt">Target date</label>
              <input id="tgt" type="date" min={TODAY} value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          </div>
          <div className="field" style={{ marginTop: 10 }}><label htmlFor="why">Rationale (required)</label>
            <textarea id="why" value={why} onChange={(e) => setWhy(e.target.value)} /></div>
          <div style={{ marginTop: 10 }}><button className="btn primary" disabled={!target || !why.trim()} onClick={confirm}>Record decision as {user.name}</button></div>
        </section>
      )}
      {!can('decision.create') && <p className="muted small">Only a Procurement Manager can select a response. Analysts and managers can shortlist.</p>}
    </div>
  )
}
