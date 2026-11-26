import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { PageHead, Tabs, formatTime } from '../components/ui'
import { SUPPLIERS } from '../prototype/data'
import { FIELDS, MAPPING_VERSION } from '../prototype/quotes'
import { CODE_LABEL, confirmMatch, correctAndReplay, dismiss, reopen, resolveWithLink, useReview, type ReviewItem } from '../prototype/review'
import { RepresentativeBadge } from '../prototype/parts'

const SEV: Record<ReviewItem['severity'], string> = { high: 'b-bad', medium: 'b-warn', low: 'b-neutral' }
const STATE: Record<ReviewItem['state'], [string, string]> = { open: ['b-warn', 'Open'], resolved: ['b-ok', 'Resolved'], dismissed: ['b-neutral', 'Dismissed'] }
type Filter = 'open' | 'done' | 'all'

function Item({ item, editable }: { item: ReviewItem; editable: boolean }) {
  const { user } = useAuth()
  const [link, setLink] = useState(item.candidates.find((c) => c.id)?.id ?? '')
  const [edit, setEdit] = useState<Record<string, string>>({ ...item.raw })
  const [why, setWhy] = useState('')
  const [result, setResult] = useState<string[] | null>(null)
  const open = item.state === 'open'
  const changedKeys = Object.keys(edit).filter((k) => edit[k] !== item.raw[k])

  return (
    <section className="card" aria-label={`Review item ${item.id}`}>
      <header>
        <h2 style={{ fontSize: 15 }}>{CODE_LABEL[item.code]}: {item.raw.supplier}</h2>
        <span className="row"><span className={`badge ${SEV[item.severity]}`}>{item.severity} severity</span><span className={`badge ${STATE[item.state][0]}`}>{STATE[item.state][1]}</span></span>
      </header>
      <p className="small muted" style={{ marginTop: 0 }}>{item.source} · owner: {item.owner} · raised {formatTime(item.createdAt)}</p>
      {item.reasons.map((r) => <div key={r} className="small" style={{ marginBottom: 2 }}>{r}</div>)}

      {item.kind === 'quote_row' && (
        <>
          <h3 style={{ margin: '12px 0 6px' }}>Original and corrected values</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Field</th><th>Original</th><th>{open ? 'Corrected' : 'Final'}</th></tr></thead>
              <tbody>
                {FIELDS.map((f) => (
                  <tr key={f.column}>
                    <td className="mono">{f.column}</td><td>{item.raw[f.column] || <span className="muted">(blank)</span>}</td>
                    <td>{open && editable
                      ? <input aria-label={f.column} value={edit[f.column] ?? ''} onChange={(e) => setEdit({ ...edit, [f.column]: e.target.value })} style={{ width: '100%' }} className={edit[f.column] !== item.raw[f.column] ? 'changed' : ''} />
                      : (item.corrected?.[f.column] ?? item.raw[f.column]) || <span className="muted">(blank)</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {item.candidates.length > 0 && (
        <>
          <h3 style={{ margin: '12px 0 6px' }}>{item.kind === 'supplier_match' ? 'Registry candidates' : 'Possible suppliers'}</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Candidate</th>{item.kind === 'supplier_match' && <><th>Confidence</th><th>Registry record</th></>}<th /></tr></thead>
              <tbody>
                {item.candidates.map((c, i) => (
                  <tr key={i}>
                    <td>{c.label}</td>
                    {item.kind === 'supplier_match' && <><td>{c.confidence?.toFixed(2)}</td><td className="small mono">{c.registryId}</td></>}
                    <td>{open && editable && item.kind === 'supplier_match' && <button className="btn" onClick={() => confirmMatch(item.id, i, user.name)}>Confirm this match</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {open && editable && item.kind === 'quote_row' && (
        <div className="row" style={{ marginTop: 12, alignItems: 'flex-end' }}>
          {(item.code === 'AMBIGUOUS_SUPPLIER' || item.code === 'UNKNOWN_SUPPLIER') && (
            <>
              <div className="field">
                <label htmlFor={`link-${item.id}`}>Link “{item.raw.supplier}” to a Supplier Master record</label>
                <select id={`link-${item.id}`} value={link} onChange={(e) => setLink(e.target.value)}>
                  <option value="">Choose a supplier…</option>
                  {SUPPLIERS.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.country})</option>)}
                </select>
              </div>
              <button className="btn primary" disabled={!link} onClick={() => setResult(resolveWithLink(item.id, link, user.name).messages)}>Link and replay</button>
              <Link className="btn" to={`/master?new=1&name=${encodeURIComponent(item.raw.supplier)}`}>Not listed: add to the master</Link>
            </>
          )}
          <button className={item.code === 'AMBIGUOUS_SUPPLIER' || item.code === 'UNKNOWN_SUPPLIER' ? 'btn' : 'btn primary'} disabled={changedKeys.length === 0} onClick={() => setResult(correctAndReplay(item.id, edit, user.name).messages)}>
            Save correction and replay ({MAPPING_VERSION})
          </button>
        </div>
      )}
      {result && open && <div className="notice" role="alert" style={{ marginTop: 10 }}>Still rejected: {result.join(' ')}</div>}

      {open && editable && (
        <div className="row" style={{ marginTop: 10 }}>
          <input aria-label="Reason for dismissing" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Reason, if dismissing" style={{ minWidth: 260 }} />
          <button className="btn" disabled={why.trim().length < 5} onClick={() => dismiss(item.id, why.trim(), user.name)}>Dismiss</button>
        </div>
      )}
      {!open && editable && <div style={{ marginTop: 10 }}><button className="btn" onClick={() => reopen(item.id, user.name)}>Reopen</button></div>}

      <h3 style={{ margin: '12px 0 6px' }}>History</h3>
      <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
        {item.events.map((e, i) => <li key={i}>{formatTime(e.at)} · {e.by} · <strong>{e.action}</strong>: {e.detail}</li>)}
      </ul>
    </section>
  )
}

export function DataReview() {
  const { can } = useAuth()
  const { items } = useReview()
  const [filter, setFilter] = useState<Filter>('open')
  const editable = can('review.resolve')
  const open = items.filter((i) => i.state === 'open')
  const shown = items.filter((i) => (filter === 'all' ? true : filter === 'open' ? i.state === 'open' : i.state !== 'open'))

  return (
    <div className="page">
      <PageHead title="Data review">
        Rows and supplier matches that cannot yet enter the scores or landed cost. Correct or confirm each one; the row is replayed through the same validation. A published comparison or issued pack is never rewritten by a correction.
      </PageHead>
      <div className="row"><RepresentativeBadge /><span className="muted small">Quote rows rejected on <Link to="/data">Data & quotes</Link> arrive here. Registry matches come from the Credibl stand-in.</span></div>

      <div className="grid tiles">
        <div className="tile"><h3>Open items</h3><div className="big">{open.length}</div><div className="sub">{open.filter((i) => i.severity === 'high').length} high severity</div></div>
        <div className="tile"><h3>Quote rows</h3><div className="big">{open.filter((i) => i.kind === 'quote_row').length}</div><div className="sub">waiting; their quotes are not in any score</div></div>
        <div className="tile"><h3>Registry matches</h3><div className="big">{open.filter((i) => i.kind === 'supplier_match').length}</div><div className="sub">below the auto-accept confidence</div></div>
        <div className="tile"><h3>Resolved or dismissed</h3><div className="big">{items.length - open.length}</div><div className="sub">kept with their history</div></div>
      </div>

      <div className="row"><Tabs tabs={[{ id: 'open', label: 'Open' }, { id: 'done', label: 'Closed' }, { id: 'all', label: 'All' }]} value={filter} onChange={setFilter} /></div>
      {!editable && <div className="notice info">Your role can view but not resolve review items.</div>}
      {shown.length === 0 ? <div className="card empty">{filter === 'open' ? 'Nothing waiting. Rejected rows and unconfirmed matches will appear here.' : 'No items.'}</div>
        : shown.map((i) => <Item key={`${i.id}-${i.state}`} item={i} editable={editable} />)}
    </div>
  )
}
