import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { ModeBadge, PageHead, formatTime } from '../components/ui'
import { METRICS, SUPPLIER_BY_ID, fmtDate, landedCost, quoteOf, usd } from '../prototype/data'
import { SRC } from '../prototype/market'
import { FIELDS, MAPPING_VERSION, SAMPLE_CSV, TEMPLATE_CSV, commitQuotes, parseQuotes, removeQuote, resetQuotes, useQuotes, type ParseResult } from '../prototype/quotes'
import { RepresentativeBadge } from '../prototype/parts'
import { queueRejections, useReview } from '../prototype/review'
import { useSelection } from '../prototype/selection'

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

const ROW_BADGE = { accepted: ['b-ok', 'Accepted'], warning: ['b-warn', 'Accepted with warning'], rejected: ['b-bad', 'Rejected'] } as const

export function DataQuotes() {
  const { user, can } = useAuth()
  const { selected, requirement } = useSelection()
  const { meta, log, version } = useQuotes()
  const { items: reviewItems } = useReview()
  const openReview = reviewItems.filter((i) => i.state === 'open' && i.kind === 'quote_row').length
  const fileRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const parsed: ParseResult | null = useMemo(() => (file ? parseQuotes(file.text) : null), [file])
  const editable = can('data.import') || can('config.edit')

  const fresh = [
    { product: 'C-01', what: 'Commodity reference', source: 'Credibl reference data', asOf: '2026-11-01', refreshed: '2026-11-25', stale: false },
    { product: 'C-02', what: 'Country supply', source: SRC.supply.source, asOf: SRC.supply.asOf, refreshed: SRC.supply.refreshed, stale: false },
    { product: 'C-03', what: 'Trade flows', source: SRC.trade.source, asOf: SRC.trade.asOf, refreshed: SRC.trade.refreshed, stale: false },
    { product: 'C-04', what: 'Price references', source: SRC.price.source, asOf: SRC.price.asOf, refreshed: SRC.price.refreshed, stale: false },
    ...METRICS.filter((m) => m.product !== 'Client quote').map((m) => ({ product: m.product, what: m.label, source: m.source, asOf: m.asOf, refreshed: m.refreshed, stale: !!m.stale })),
  ]

  const onFile = async (f?: File) => {
    if (!f) return
    setDone(null)
    setFile({ name: f.name, text: await f.text() })
  }
  const counts = parsed && { ok: parsed.rows.filter((r) => r.status !== 'rejected').length, bad: parsed.rows.filter((r) => r.status === 'rejected').length }
  const approve = () => {
    if (!parsed || !file) return
    const n = commitQuotes(parsed.rows, file.name, user.name)
    const q = queueRejections(parsed.rows, file.name, user.name)
    setDone(`${n} quote${n === 1 ? '' : 's'} loaded from ${file.name}. Landed cost and the comparison use them now.${q ? ` ${q} rejected row${q === 1 ? '' : 's'} sent to Data review.` : ''}`)
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  void version
  return (
    <div className="page">
      <PageHead title="Data & quotes">
        Confirm the market data is current, then load the client’s quotes, freight, terms and lead times. Rows that fail validation never enter the scores or landed cost.
      </PageHead>
      <div className="row"><RepresentativeBadge /><ModeBadge mode="simulated" /><span className="muted small">Credibl data comes from an API-shaped stand-in until its test environment is available. This prototype reads CSV; Excel is read in the build.</span></div>

      <section className="card">
        <header><h2>Credibl data products</h2><span className="muted small">Status and freshness</span></header>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Product</th><th>Content</th><th>Source</th><th>As of</th><th>Refreshed</th><th>Status</th></tr></thead>
            <tbody>
              {fresh.map((f, i) => (
                <tr key={i}>
                  <td>{f.product}</td><td className="small">{f.what}</td><td className="small">{f.source}</td>
                  <td className="small">{fmtDate(f.asOf)}</td><td className="small">{fmtDate(f.refreshed)}</td>
                  <td>{f.stale ? <span className="badge b-warn" title="Annual baseline">Stale</span> : <span className="badge b-ok">Current</span>} <ModeBadge mode="simulated" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <header><h2>Load client quotes</h2><span className="muted small">Mapping {MAPPING_VERSION}</span></header>
        <div className="row">
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} aria-label="Quote file" disabled={!editable} />
          <button className="btn" onClick={() => { setDone(null); setFile({ name: 'sample-quotes.csv', text: SAMPLE_CSV }) }} disabled={!editable}>Use the sample file</button>
          <button className="btn" onClick={() => download('quote-template.csv', TEMPLATE_CSV)}>Download template</button>
          <button className="btn" onClick={() => download('sample-quotes.csv', SAMPLE_CSV)}>Download sample</button>
        </div>
        {!editable && <p className="muted small">Your role can view but not load data.</p>}
        {done && <p className="ok-text small" role="status">{done} {openReview > 0 && <Link to="/review">Open Data review</Link>}</p>}

        {parsed?.fatal && <div className="notice" role="alert" style={{ marginTop: 10 }}>{parsed.fatal}</div>}
        {parsed && !parsed.fatal && file && (
          <>
            <h3 style={{ marginBottom: 6 }}>Mapping preview</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Source column</th><th>Business field</th><th>Found</th></tr></thead>
                <tbody>
                  {parsed.columns.map((c) => (
                    <tr key={c.column}><td className="mono">{c.column}</td><td>{c.field}{c.required ? '' : ' (optional)'}</td><td>{c.found ? <span className="badge b-ok">Yes</span> : <span className="badge b-neutral">Not in file</span>}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 style={{ margin: '16px 0 6px' }}>Row check: {file.name}</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Line</th><th>Supplier in file</th><th>Matched to</th><th>Unit price (USD/t)</th><th>Freight</th><th>Tariff</th><th>Lead</th><th>Result</th></tr></thead>
                <tbody>
                  {parsed.rows.map((r) => (
                    <tr key={r.line}>
                      <td>{r.line}</td><td>{r.raw.supplier}</td>
                      <td>{r.supplier ? r.supplier.name : <span className="muted">No match</span>}</td>
                      <td>{r.quote ? r.quote.priceUsdPerT.toLocaleString('en-GB') : <span className="muted">{r.raw.price_usd_per_t} {r.raw.currency}/{r.raw.unit}</span>}</td>
                      <td>{r.raw.freight_usd === '' ? <span className="badge b-warn">Missing</span> : Number(r.raw.freight_usd || 0).toLocaleString('en-GB')}</td>
                      <td>{r.raw.tariff_pct === '' ? <span className="badge b-warn">Missing</span> : `${r.raw.tariff_pct}%`}</td>
                      <td>{r.raw.lead_weeks} wk</td>
                      <td>
                        <span className={`badge ${ROW_BADGE[r.status][0]}`}>{ROW_BADGE[r.status][1]}</span>
                        {r.messages.map((m) => <div key={m} className="small muted">{m}</div>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" onClick={approve} disabled={!editable || !counts || counts.ok === 0}>Approve and load {counts?.ok ?? 0} quote{counts?.ok === 1 ? '' : 's'}</button>
              <button className="btn" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = '' }}>Cancel</button>
              {!!counts?.bad && <span className="small muted">{counts.bad} rejected row{counts.bad === 1 ? '' : 's'} stay out of the scores. Correct the file and load it again; a re-load replaces earlier quotes and creates no duplicates.</span>}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <header><h2>Quotes for the selected suppliers</h2><span className="muted small">{selected.length} selected · {requirement.volumeT} t {requirement.form}</span></header>
        {selected.length === 0 ? <div className="empty">No suppliers selected. <Link to="/suppliers">Choose from the dashboard</Link>.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Supplier</th><th>Quote</th><th>Unit price</th><th>Freight</th><th>Tariff</th><th>Lead</th><th>Quote date</th><th>Source</th><th>Landed cost</th><th /></tr></thead>
              <tbody>
                {selected.map((id) => {
                  const s = SUPPLIER_BY_ID[id]
                  const q = quoteOf(s)
                  const lc = landedCost(s, requirement.volumeT)
                  const m = meta[id]
                  return (
                    <tr key={id}>
                      <td><Link to={`/suppliers/${id}`}>{s.name}</Link></td>
                      <td>{q ? <span className="badge b-ok">Quoted</span> : <span className="badge b-warn" title="Reference price is used and marked indicative">No quote: indicative</span>}</td>
                      <td>{q ? q.priceUsdPerT.toLocaleString('en-GB') : <span className="muted">reference</span>}</td>
                      <td>{q ? (q.missing?.includes('freight') ? <span className="badge b-warn">Missing</span> : q.freightUsd.toLocaleString('en-GB')) : <span className="muted">assumed</span>}</td>
                      <td>{q ? (q.missing?.includes('tariff') ? <span className="badge b-warn">Missing</span> : `${q.tariffPct}%`) : <span className="muted">–</span>}</td>
                      <td>{q ? `${q.leadWeeks} wk` : <span className="muted">unknown</span>}</td>
                      <td className="small">{q ? fmtDate(q.quotedOn) : '–'}</td>
                      <td className="small">{q ? (m ? `${m.file}, ${m.by}` : 'Preloaded representative sample') : '–'}</td>
                      <td>{usd(lc.total)}{lc.indicative && <> <span className="badge b-warn">Indicative</span></>}</td>
                      <td>{q && editable && <button className="btn" onClick={() => removeQuote(id, user.name)} aria-label={`Remove the quote for ${s.name}`}>Remove</button>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>A missing freight or tariff value is counted as zero and flagged; it is never treated as a good result. Costs that are not supplied, such as financing or storage, are not estimated.</p>
      </section>

      <div className="row"><Link to="/comparison" className="btn primary">Continue to the comparison</Link><span className="muted small">Suppliers without a quote are priced from the reference and marked indicative.</span></div>

      <section className="card">
        <header><h2>Load history</h2><button className="btn" onClick={() => resetQuotes(user.name)} disabled={!editable || log.length === 0}>Reset to the sample</button></header>
        {log.length === 0 ? <div className="empty">No file loaded yet. The preloaded representative quotes are in use.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Who</th><th>File</th><th>Accepted</th><th>Rejected</th><th>Note</th></tr></thead>
              <tbody>{log.map((e, i) => <tr key={i}><td>{formatTime(e.at)}</td><td>{e.by}</td><td>{e.file}</td><td>{e.accepted}</td><td>{e.rejected}</td><td className="small">{e.note ?? ''}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="muted small" style={{ marginBottom: 0 }}>Expected columns: {FIELDS.map((f) => f.column).join(', ')}.</p>
      </section>
    </div>
  )
}
