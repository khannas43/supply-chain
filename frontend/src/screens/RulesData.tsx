import { useState } from 'react'
import { api } from '../api/client'
import { useApi } from '../api/hooks'
import type { AssumptionData, DatasetData, ImportData, ImportReport, ReferenceData, RuleData } from '../api/types'
import { useAuth } from '../auth/AuthContext'
import { PageHead, Tabs, formatTime } from '../components/ui'

type Tab = 'rules' | 'assumptions' | 'imports' | 'reference'

function Failure({ message, retry }: { message: string | null; retry: () => void }) {
  return message ? <div className="notice" role="alert">{message} <button className="btn" onClick={retry}>Retry</button></div> : null
}

function RulesTab() {
  const rules = useApi<RuleData[]>('/rules')
  const { can } = useAuth()
  const [sel, setSel] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const list = rules.data ?? []
  const rule = list.find((r) => r.id === sel) ?? list[0]
  if (!rule) return <>{rules.error ? <Failure message={rules.error} retry={rules.reload} /> : <div className="empty" role="status">Loading…</div>}</>
  const latest = rule.versions[rule.versions.length - 1]
  const published = [...rule.versions].reverse().find((v) => v.status === 'published') ?? latest
  const base = latest.status === 'draft' ? latest : published
  const editable = can('rule.draft')
  const changed = Object.keys(edits).filter((k) => edits[k] !== '')

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      setEdits({})
      rules.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="split">
      <section className="card" style={{ padding: 0 }}><div className="table-wrap"><table>
        <thead><tr><th>Rule</th><th>Commodity</th><th>Published</th><th>Latest</th></tr></thead>
        <tbody>{list.map((r) => {
          const pub = [...r.versions].reverse().find((v) => v.status === 'published')
          const last = r.versions[r.versions.length - 1]
          return (
            <tr key={r.id} className={`clickable ${r.id === rule.id ? 'sel' : ''}`} tabIndex={0} onClick={() => { setSel(r.id); setEdits({}); setError(null) }} onKeyDown={(e) => e.key === 'Enter' && (setSel(r.id), setEdits({}))}>
              <td><strong>{r.name}</strong></td><td>{r.commodity}</td><td>v{pub?.v}</td><td>v{last.v} {last.status === 'draft' && <span className="badge b-warn">draft</span>}</td>
            </tr>
          )
        })}</tbody>
      </table></div></section>

      <aside className="detail">
        <section className="card">
          <header><h2>{rule.name}</h2><span className={`badge ${latest.status === 'draft' ? 'b-warn' : 'b-ok'}`}>v{latest.v} {latest.status}</span></header>
          <p className="muted small" style={{ marginTop: 0 }}>Scores are ordinal, not probabilities. Severity is kept separate from evidence confidence. Every change creates a new version.</p>
          {error && <div className="notice" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
          {base.thresholds.map((t) => (
            <div className="field" key={t.key} style={{ marginBottom: 8 }}>
              <label htmlFor={`t-${t.key}`}>{t.label} ({t.unit})</label>
              <input id={`t-${t.key}`} type="number" disabled={!editable} value={edits[t.key] ?? String(t.value)} onChange={(e) => setEdits({ ...edits, [t.key]: e.target.value })} />
            </div>
          ))}
          {editable ? (
            <div className="row">
              <button className="btn" disabled={changed.length === 0 || busy} onClick={() => act(() => api.post(`/rules/${rule.id}/draft`, { thresholds: changed.map((k) => ({ key: k, value: Number(edits[k]) })) }))}>{latest.status === 'draft' ? 'Update draft' : 'Save as new draft'}</button>
              {latest.status === 'draft' && changed.length === 0 && can('rule.publish') && <button className="btn primary" disabled={busy} onClick={() => act(() => api.post(`/rules/${rule.id}/versions/${latest.v}/publish`, {}))}>Publish v{latest.v}</button>}
            </div>
          ) : <div className="muted small">Only an Analyst or Admin can draft rules.</div>}
          <h3 style={{ marginTop: 14 }}>History</h3>
          {[...rule.versions].reverse().map((v) => (
            <div key={v.v} className="small" style={{ marginTop: 6 }}>
              <strong>v{v.v}</strong> <span className="badge b-neutral">{v.status}</span> drafted by {v.createdBy}, {formatTime(v.createdAt)}
              {v.publishedBy && <> · published by {v.publishedBy}, {formatTime(v.publishedAt!)}</>}
            </div>
          ))}
        </section>
      </aside>
    </div>
  )
}

function AssumptionsTab() {
  const list = useApi<AssumptionData[]>('/assumptions')
  return (
    <section className="card" style={{ padding: 0 }}>
      <Failure message={list.error} retry={list.reload} />
      {list.data === null ? !list.error && <div className="empty" role="status">Loading…</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Assumption</th><th>Alert</th><th>Affected share</th><th>Basis</th><th>Status</th><th>Proposed by</th><th>Decided by</th></tr></thead>
          <tbody>{list.data.map((a) => (
            <tr key={a.id}>
              <td className="mono">{a.id}</td><td>{a.alertId}</td><td>{a.affectedSharePct}%</td><td>{a.basis}</td>
              <td><span className={`badge ${a.status === 'approved' ? 'b-ok' : a.status === 'proposed' ? 'b-warn' : 'b-neutral'}`}>{a.status}</span></td>
              <td>{a.proposedBy.name}</td><td>{a.decidedBy?.name ?? <span className="muted">—</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      <p className="muted small" style={{ padding: '0 16px' }}>Proposing and approving happens on the impact screen. This is the read-only library.</p>
    </section>
  )
}

function ImportsTab() {
  const datasets = useApi<DatasetData[]>('/imports/datasets')
  const history = useApi<ImportData[]>('/imports')
  const { can } = useAuth()
  const [ds, setDs] = useState('supplier_network')
  const [text, setText] = useState('')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [msg, setMsg] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const canImport = can('data.import')
  const spec = datasets.data?.find((d) => d.id === ds)

  const reset = () => { setReport(null); setMsg(null) }
  const call = async <T,>(path: string): Promise<T | null> => {
    setBusy(true)
    setMsg(null)
    try {
      return await api.post<T>(path, { dataset: ds, csv: text })
    } catch (e) {
      setMsg({ kind: 'warn', text: (e as Error).message })
      return null
    } finally {
      setBusy(false)
    }
  }
  const check = async () => { setReport(null); const r = await call<ImportReport>('/imports/validate'); if (r) setReport(r) }
  const commit = async () => {
    const r = await call<ImportData>('/imports')
    if (!r) return
    setMsg({ kind: 'info', text: `Imported as ${r.id}, ${spec?.label} version ${r.version}: ${r.rows} accepted, ${r.rejected} sent to quarantine.${r.applied ? '' : ' These rows are recorded and validated; assessments do not use this dataset yet.'}` })
    setReport(null)
    history.reload()
  }
  const onFile = async (f?: File) => { if (f) { setText(await f.text()); reset() } }

  if (!datasets.data) return <>{datasets.error ? <Failure message={datasets.error} retry={datasets.reload} /> : <div className="empty" role="status">Loading…</div>}</>

  return (
    <div className="grid two">
      <section className="card">
        <header><h2>Import</h2></header>
        {!canImport && <div className="notice info" style={{ marginBottom: 10 }}>You can validate a file here. Only a Data Steward or Admin can commit an import.</div>}
        <div className="field">
          <label htmlFor="ds">Dataset</label>
          <select id="ds" value={ds} onChange={(e) => { setDs(e.target.value); setText(''); reset() }}>
            {datasets.data.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          {spec && <div className="muted small">Required columns: {spec.required.join(', ')}{spec.applied ? '' : '. Recorded and validated only; not yet used by assessments.'}</div>}
          <label htmlFor="file">CSV file</label>
          <input id="file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          <label htmlFor="csv">or paste CSV</label>
          <textarea id="csv" className="mono" style={{ minHeight: 140 }} value={text} onChange={(e) => { setText(e.target.value); setReport(null) }} />
          <div className="row">
            <button className="btn" onClick={() => { setText(spec?.sample ?? ''); reset() }}>Load sample</button>
            <button className="btn primary" disabled={!text.trim() || busy} onClick={check}>Validate</button>
          </div>
        </div>
        {msg && <div className={`notice ${msg.kind === 'info' ? 'info' : ''}`} style={{ marginTop: 10 }} role="status">{msg.text}</div>}
        {report && (
          <div style={{ marginTop: 12 }}>
            <h3>Validation report</h3>
            {report.headerErrors.length > 0 ? report.headerErrors.map((e) => <div key={e} className="notice" style={{ marginTop: 6 }}>{e}</div>) : (
              <>
                <div className="row" style={{ margin: '6px 0' }}>
                  <span className="badge b-ok">{report.valid} valid</span>
                  <span className="badge b-bad">{report.rejected.length} rejected</span>
                  <span className="badge b-neutral">{report.duplicates} duplicate</span>
                </div>
                {report.rejected.map((r, i) => <div key={i} className="small">row {r.row}: {r.reason}{r.badValue ? ` (“${r.badValue}”)` : ''}</div>)}
                {report.alreadyImportedAs && <div className="notice" style={{ marginTop: 8 }}>This exact file was already imported as {report.alreadyImportedAs}. Importing it again changes nothing.</div>}
                <div style={{ marginTop: 10 }}>
                  <button className="btn primary" disabled={!canImport || report.valid === 0 || busy || !!report.alreadyImportedAs} onClick={commit}>Commit {report.valid} valid row{report.valid === 1 ? '' : 's'}</button>
                  <div className="muted small" style={{ marginTop: 6 }}>Rejected rows go to quarantine with their evidence. The original file is kept with the import.</div>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <header><h2>Import history</h2></header>
        {history.data === null ? <div className="muted" role="status">Loading…</div> : history.data.length === 0 ? <div className="muted">No imports yet.</div> : (
          <table><thead><tr><th>Import</th><th>Dataset</th><th>Version</th><th>Rows</th><th>By</th></tr></thead>
          <tbody>{history.data.map((i) => <tr key={i.id}><td className="mono">{i.id}</td><td>{datasets.data!.find((d) => d.id === i.dataset)?.label}</td><td>v{i.version}</td><td>{i.rows} ok, {i.rejected} rejected</td><td>{i.committedBy}<div className="muted small">{formatTime(i.committedAt)}</div></td></tr>)}</tbody></table>
        )}
      </section>
    </div>
  )
}

function ReferenceTab() {
  const ref = useApi<ReferenceData>('/reference')
  const { can } = useAuth()
  const [f, setF] = useState({ from: '', to: '', factor: '', date: '', source: '' })
  const [error, setError] = useState<string | null>(null)
  const ok = f.from && f.to && Number(f.factor) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.source

  const add = async () => {
    setError(null)
    try {
      await api.post('/reference/conversions', { from: f.from, to: f.to, factor: f.factor, effectiveFrom: f.date, source: f.source })
      setF({ from: '', to: '', factor: '', date: '', source: '' })
      ref.reload()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!ref.data) return <>{ref.error ? <Failure message={ref.error} retry={ref.reload} /> : <div className="empty" role="status">Loading…</div>}</>
  const d = ref.data
  return (
    <div className="grid two">
      <section className="card">
        <header><h2>Unit and currency conversions</h2><span className="muted small">dated; new rows never overwrite old ones</span></header>
        <table><thead><tr><th>From</th><th>To</th><th>Factor</th><th>Effective</th><th>Source</th></tr></thead>
        <tbody>{d.conversions.map((c) => <tr key={c.id}><td>{c.from}</td><td>{c.to}</td><td>{c.factor}</td><td>{c.effectiveFrom}</td><td>{c.source}</td></tr>)}</tbody></table>
        {can('reference.edit') ? (
          <div style={{ marginTop: 12 }}>
            <h3>Add a conversion</h3>
            {error && <div className="notice" role="alert" style={{ marginTop: 6 }}>{error}</div>}
            <div className="grid two" style={{ marginTop: 6 }}>
              {(['from', 'to', 'factor', 'date', 'source'] as const).map((k) => (
                <div className="field" key={k}><label htmlFor={`cv-${k}`}>{k === 'date' ? 'Effective from (YYYY-MM-DD)' : k[0].toUpperCase() + k.slice(1)}</label>
                  <input id={`cv-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}><button className="btn primary" disabled={!ok} onClick={add}>Add conversion</button></div>
          </div>
        ) : <p className="muted small">Only a Data Steward or Admin can add reference data.</p>}
      </section>
      <section className="card">
        <header><h2>Countries and aliases</h2></header>
        <table><thead><tr><th>Code</th><th>Country</th><th>Aliases</th></tr></thead>
        <tbody>{d.countries.map((c) => <tr key={c.code}><td className="mono">{c.code}</td><td>{c.name}</td><td>{c.aliases.join(', ')}</td></tr>)}</tbody></table>
        <h3 style={{ marginTop: 14 }}>Commodity forms and grades</h3>
        <table><thead><tr><th>Commodity</th><th>Form</th><th>Note</th></tr></thead>
        <tbody>{d.forms.map((x) => <tr key={x.form}><td>{x.commodity}</td><td>{x.form}</td><td>{x.note}</td></tr>)}</tbody></table>
      </section>
    </div>
  )
}

export function RulesData() {
  const [tab, setTab] = useState<Tab>('rules')
  return (
    <div className="page">
      <PageHead title="Rules and reference data">
        The configuration and master data the calculations depend on. Every change creates a new version; nothing is edited in place.
      </PageHead>
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { id: 'rules', label: 'Risk rules' }, { id: 'assumptions', label: 'Assumptions library' },
        { id: 'imports', label: 'Imports' }, { id: 'reference', label: 'Reference data' },
      ]} />
      {tab === 'rules' && <RulesTab />}
      {tab === 'assumptions' && <AssumptionsTab />}
      {tab === 'imports' && <ImportsTab />}
      {tab === 'reference' && <ReferenceTab />}
    </div>
  )
}
