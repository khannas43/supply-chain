import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useApi } from '../api/hooks'
import type { ActionData, OptionRow, OptionsData, PersonData } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { AlertPicker, useAssessedAlert } from '../components/AlertPicker'
import { PageHead } from '../components/ui'
import type { ResponseOption } from '../data/types'

const num = (n: number) => (Math.round(n * 10) / 10).toLocaleString('en-US')
const today = () => new Date().toISOString().slice(0, 10)

function Body({ d, reload }: { d: OptionsData; reload: () => void }) {
  const currency = d.currency
  const { can, user } = useAuth()
  const nav = useNavigate()
  const [selecting, setSelecting] = useState<ResponseOption | null>(null)
  const people = useApi<PersonData[]>('/people')
  const assignable = (people.data ?? []).filter((p) => !(p.roles.length === 1 && p.roles[0] === 'demo_operator'))
  const [owner, setOwner] = useState('')
  const [target, setTarget] = useState('')
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shortlist = async (r: OptionRow) => {
    setError(null)
    try {
      await api.post(`/options/${r.option.id}/shortlist`, { shortlisted: !r.shortlisted })
      reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const confirm = async () => {
    if (!selecting || !target || !why.trim()) return
    const person = assignable.find((p) => p.id === owner)
    if (!person) return
    setBusy(true)
    setError(null)
    try {
      const action = await api.post<ActionData>(`/options/${selecting.id}/decision`, {
        ownerId: person.id, ownerName: person.name, targetDate: target, rationale: why.trim(),
      })
      nav(`/actions?action=${action.id}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  const quoteFlag = (r: OptionRow) => {
    if (r.quoteStatus === 'none') return null
    if (r.quoteStatus === 'expired') return <span className="badge b-bad">Quote expired</span>
    if (r.quoteStatus === 'expiring') return <span className="badge b-warn">Expires in {r.daysToQuoteExpiry} d</span>
    return <span className="muted small">valid to {r.option.quoteValidUntil}</span>
  }

  const row = (r: OptionRow) => {
    const o = r.option
    return (
      <tr key={o.id}>
        <td>{r.rank ?? '—'}</td>
        <td><strong>{o.name}</strong><div className="row"><span className="badge b-neutral">{o.type}</span>{r.shortlisted && <span className="badge b-ok">Shortlisted</span>}</div><div className="muted small">{o.note}</div></td>
        <td><span className="badge b-ok">{o.qualification}</span> <span className="badge b-neutral">spec {o.specFit}</span></td>
        <td>{o.capacity}</td>
        <td>{o.unitPrice != null ? `${currency} ${o.unitPrice.toLocaleString('en-US')}` : '—'}</td>
        <td>{o.leadTimeDays} d</td>
        <td>{quoteFlag(r)}</td>
        <td>
          {o.type === 'inventory'
            ? <>{r.extraCoverDays != null ? `+${num(r.extraCoverDays)} d cover` : '—'}<div className="muted small">excludes handling cost</div></>
            : <>Gap: {r.gapDays != null ? `${num(r.gapDays)} d` : <span className="muted">unavailable</span>}<br />Cost: {r.incrementalCost != null ? `${currency} ${r.incrementalCost.toLocaleString('en-US')}` : <span className="muted">unavailable</span>}</>}
        </td>
        <td>
          <div className="row">
            {can('option.shortlist') && <button className="btn" onClick={() => shortlist(r)}>{r.shortlisted ? 'Remove' : 'Shortlist'}</button>}
            {can('decision.create') && <button className="btn primary" onClick={() => { setSelecting(o); setOwner(assignable.find((p) => p.id === user.id)?.id ?? assignable[0]?.id ?? ''); setError(null) }}>Select</button>}
          </div>
        </td>
      </tr>
    )
  }

  const head = <thead><tr><th>Rank</th><th>Option</th><th>Qualification</th><th>Capacity</th><th>Unit price</th><th>Lead time</th><th>Quote</th><th>Effect</th><th /></tr></thead>

  return (
    <>
      <div className="notice info">
        Days of cover {d.coverDays != null ? num(d.coverDays) : 'unknown'}. Assumption status: <strong>{d.assumptionStatus}</strong>.
        {d.assumptionStatus !== 'approved' && ' Gap and cost stay unavailable until an approved disruption assumption exists.'}
      </div>
      {error && <div className="notice" role="alert">{error}</div>}

      <section className="card" style={{ padding: 0 }}>
        <header style={{ padding: '12px 16px 0' }}><h2>Ranked options</h2><span className="muted small">by availability gap, then cost, then lead time</span></header>
        {d.ranked.length === 0 ? <div className="empty">No eligible sourcing or logistics option.</div> : (
          <div className="table-wrap"><table>{head}<tbody>{d.ranked.map(row)}</tbody></table></div>
        )}
      </section>

      {d.complementary.length > 0 && (
        <section className="card" style={{ padding: 0 }}>
          <header style={{ padding: '12px 16px 0' }}><h2>Complementary: inventory</h2><span className="muted small">extends cover, not ranked against sourcing</span></header>
          <div className="table-wrap"><table>{head}<tbody>{d.complementary.map(row)}</tbody></table></div>
        </section>
      )}

      {d.ineligible.length > 0 && (
        <section className="card">
          <header><h2>Not eligible</h2></header>
          {d.ineligible.map((r) => (
            <div key={r.option.id} style={{ marginBottom: 8 }}>
              <strong>{r.option.name}</strong> <span className="badge b-neutral">{r.option.type}</span>
              {r.reasons.map((x) => <div key={x} className="muted small">{x}</div>)}
            </div>
          ))}
        </section>
      )}

      {selecting && (
        <section className="card" aria-label="Record decision">
          <header><h2>Record decision: {selecting.name}</h2><button className="btn" onClick={() => setSelecting(null)}>Cancel</button></header>
          {d.assumptionStatus !== 'approved' && <div className="notice" style={{ marginBottom: 10 }}>This decision rests on an assumption that is {d.assumptionStatus}. It will be flagged for review if the assessment changes.</div>}
          <div className="grid two">
            <div className="field"><label htmlFor="own">Owner</label>
              <select id="own" value={owner} onChange={(e) => setOwner(e.target.value)}>
                {assignable.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></div>
            <div className="field"><label htmlFor="tgt">Target date</label>
              <input id="tgt" type="date" min={today()} value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          </div>
          <div className="field" style={{ marginTop: 10 }}><label htmlFor="why">Rationale (required)</label>
            <textarea id="why" value={why} onChange={(e) => setWhy(e.target.value)} /></div>
          <div style={{ marginTop: 10 }}><button className="btn primary" disabled={!target || !why.trim() || !owner || busy} onClick={confirm}>{busy ? 'Saving…' : `Record decision as ${user.name}`}</button></div>
        </section>
      )}
      {!can('decision.create') && <p className="muted small">Only a Procurement Manager can select a response. Analysts and managers can shortlist.</p>}
    </>
  )
}

export function Response() {
  const { alert, list, set, remote } = useAssessedAlert()
  const options = useApi<OptionsData>(alert ? `/alerts/${alert.id}/options` : null)
  const error = remote.error ?? options.error
  const ready = alert && options.data?.alertId === alert.id

  return (
    <div className="page">
      <PageHead title="Response comparison">
        Options are filtered by qualification and specification before they are ranked. Recommendations are confirmed by a person; nothing here places an order, and capacity and commercial terms are not verified.
      </PageHead>
      {error && <div className="notice" role="alert">{error} <button className="btn" onClick={() => { remote.reload(); options.reload() }}>Retry</button></div>}
      {remote.data !== null && !alert && <div className="card empty">No assessed alert for this commodity yet.</div>}
      {alert && <div className="row"><AlertPicker list={list} value={alert.id} onChange={set} /></div>}
      {ready ? <Body d={options.data!} reload={options.reload} /> : (alert || remote.data === null) && !error && <div className="empty" role="status">Loading…</div>}
    </div>
  )
}
