import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { PageHead, Tabs, formatTime } from '../components/ui'
import { countries, DATASETS, forms, type DatasetSpec, type Threshold } from '../data/pipeline'
import { usePipeline } from '../data/pipelineStore'
import { useStore } from '../data/store'

type Tab = 'rules' | 'assumptions' | 'imports' | 'reference'

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (!line.trim()) continue
    const out: string[] = []
    let cur = ''
    let q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
      else if (c === ',' && !q) { out.push(cur); cur = '' }
      else cur += c
    }
    out.push(cur)
    rows.push(out.map((x) => x.trim()))
  }
  return rows
}

const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s

interface Report { headerErrors: string[]; valid: number; duplicates: number; rejected: { reason: string; row: string; field: string; bad: string }[]; checksum: string }

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function validate(spec: DatasetSpec, text: string): Promise<Report> {
  const checksum = await sha256(text)
  const [head, ...body] = parseCsv(text)
  const headerErrors = head ? spec.required.filter((c) => !head.includes(c)).map((c) => `Missing column: ${c}`) : ['File is empty']
  const rejected: Report['rejected'] = []
  const seen = new Set<string>()
  let valid = 0, duplicates = 0
  if (!headerErrors.length) {
    body.forEach((cells, i) => {
      const row = Object.fromEntries(head.map((h, k) => [h, cells[k] ?? '']))
      const where = `row ${i + 2}`
      const bad = (reason: string, field: string) => rejected.push({ reason, row: where, field, bad: row[field] ?? '' })
      for (const c of spec.required) if (!row[c]) return bad(`Missing required field: ${c}`, c)
      for (const c of spec.numeric ?? []) if (Number.isNaN(Number(row[c]))) return bad(`${c} is not a number`, c)
      for (const c of spec.dates ?? []) if (!validDate(row[c])) return bad(`${c} is not a valid date (YYYY-MM-DD)`, c)
      for (const [c, allowed] of Object.entries(spec.enums ?? {})) if (!allowed.includes(row[c])) return bad(`${c} must be one of ${allowed.join(', ')}`, c)
      const key = cells.join('|')
      if (seen.has(key)) { duplicates++; return }
      seen.add(key)
      valid++
    })
  }
  return { headerErrors, valid, duplicates, rejected, checksum }
}

function RulesTab() {
  const { rules, saveDraft, publish } = usePipeline()
  const { can } = useAuth()
  const [sel, setSel] = useState(rules[0].id)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const rule = rules.find((r) => r.id === sel)!
  const latest = rule.versions[rule.versions.length - 1]
  const shown = rule.versions.find((v) => v.status === 'published') ?? latest
  const base = latest.status === 'draft' ? latest : shown
  const editable = can('rule.draft')

  const save = () => {
    const th: Threshold[] = base.thresholds.map((t) => ({ ...t, value: edits[t.key] !== undefined && edits[t.key] !== '' ? Number(edits[t.key]) : t.value }))
    if (th.some((t) => Number.isNaN(t.value))) return
    saveDraft(rule.id, th)
    setEdits({})
  }

  return (
    <div className="split">
      <section className="card" style={{ padding: 0 }}><div className="table-wrap"><table>
        <thead><tr><th>Rule</th><th>Commodity</th><th>Published</th><th>Latest</th></tr></thead>
        <tbody>{rules.map((r) => {
          const pub = r.versions.find((v) => v.status === 'published')
          const last = r.versions[r.versions.length - 1]
          return (
            <tr key={r.id} className={`clickable ${r.id === sel ? 'sel' : ''}`} tabIndex={0} onClick={() => { setSel(r.id); setEdits({}) }} onKeyDown={(e) => e.key === 'Enter' && (setSel(r.id), setEdits({}))}>
              <td><strong>{r.name}</strong></td><td>{r.commodity}</td><td>v{pub?.v}</td><td>v{last.v} {last.status === 'draft' && <span className="badge b-warn">draft</span>}</td>
            </tr>
          )
        })}</tbody>
      </table></div></section>

      <aside className="detail">
        <section className="card">
          <header><h2>{rule.name}</h2><span className={`badge ${latest.status === 'draft' ? 'b-warn' : 'b-ok'}`}>v{latest.v} {latest.status}</span></header>
          <p className="muted small" style={{ marginTop: 0 }}>Scores are ordinal, not probabilities. Severity is kept separate from evidence confidence. Every change creates a new version.</p>
          {base.thresholds.map((t) => (
            <div className="field" key={t.key} style={{ marginBottom: 8 }}>
              <label htmlFor={`t-${t.key}`}>{t.label} ({t.unit})</label>
              <input id={`t-${t.key}`} type="number" disabled={!editable} value={edits[t.key] ?? String(t.value)} onChange={(e) => setEdits({ ...edits, [t.key]: e.target.value })} />
            </div>
          ))}
          {editable ? (
            <div className="row">
              <button className="btn" disabled={Object.keys(edits).length === 0} onClick={save}>{latest.status === 'draft' ? 'Update draft' : 'Save as new draft'}</button>
              {latest.status === 'draft' && Object.keys(edits).length === 0 && can('rule.publish') && <button className="btn primary" onClick={() => publish(rule.id, latest.v)}>Publish v{latest.v}</button>}
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
  const { assumptions } = useStore()
  return (
    <section className="card" style={{ padding: 0 }}><div className="table-wrap"><table>
      <thead><tr><th>Assumption</th><th>Alert</th><th>Affected share</th><th>Basis</th><th>Status</th><th>Proposed by</th><th>Decided by</th></tr></thead>
      <tbody>{assumptions.map((a) => (
        <tr key={a.id}>
          <td className="mono">{a.id}</td><td>{a.alertId}</td><td>{a.affectedSharePct}%</td><td>{a.basis}</td>
          <td><span className={`badge ${a.status === 'approved' ? 'b-ok' : a.status === 'proposed' ? 'b-warn' : 'b-neutral'}`}>{a.status}</span></td>
          <td>{a.proposedBy.name}</td><td>{a.decidedBy?.name ?? <span className="muted">—</span>}</td>
        </tr>
      ))}</tbody>
    </table></div>
    <p className="muted small" style={{ padding: '0 16px' }}>Proposing and approving happens on the impact screen. This is the read-only library.</p></section>
  )
}

function ImportsTab() {
  const { imports, commitImport } = usePipeline()
  const { can } = useAuth()
  const [ds, setDs] = useState(DATASETS[0].id)
  const [text, setText] = useState('')
  const [report, setReport] = useState<Report | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const spec = DATASETS.find((d) => d.id === ds)!
  const canImport = can('data.import')

  const check = async () => { setMsg(null); setReport(await validate(spec, text)) }
  const commit = () => {
    if (!report) return
    const dup = imports.find((i) => i.checksum === report.checksum && i.dataset === ds)
    if (dup) { setMsg(`This exact file was already imported as ${dup.id} (v${dup.version}). Nothing changed.`); return }
    const rec = commitImport({ dataset: ds, rows: report.valid, rejected: report.rejected.length, checksum: report.checksum }, report.rejected)
    setMsg(`Imported as ${rec.id}, ${spec.label} version ${rec.version}: ${rec.rows} accepted, ${rec.rejected} sent to quarantine.`)
    setReport(null)
  }
  const onFile = async (f?: File) => { if (f) { setText(await f.text()); setReport(null); setMsg(null) } }

  return (
    <div className="grid two">
      <section className="card">
        <header><h2>Import</h2></header>
        {!canImport && <div className="notice info" style={{ marginBottom: 10 }}>You can review imports here. Only a Data Steward or Admin can commit one.</div>}
        <div className="field">
          <label htmlFor="ds">Dataset</label>
          <select id="ds" value={ds} onChange={(e) => { setDs(e.target.value); setText(''); setReport(null); setMsg(null) }}>
            {DATASETS.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
          <div className="muted small">Required columns: {spec.required.join(', ')}</div>
          <label htmlFor="file">CSV file</label>
          <input id="file" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
          <label htmlFor="csv">or paste CSV</label>
          <textarea id="csv" className="mono" style={{ minHeight: 140 }} value={text} onChange={(e) => { setText(e.target.value); setReport(null) }} />
          <div className="row">
            <button className="btn" onClick={() => { setText(spec.sample); setReport(null); setMsg(null) }}>Load sample</button>
            <button className="btn primary" disabled={!text.trim()} onClick={check}>Validate</button>
          </div>
        </div>
        {msg && <div className="notice info" style={{ marginTop: 10 }} role="status">{msg}</div>}
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
                {report.rejected.map((r, i) => <div key={i} className="small">{r.row}: {r.reason}{r.bad ? ` (“${r.bad}”)` : ''}</div>)}
                <div style={{ marginTop: 10 }}>
                  <button className="btn primary" disabled={!canImport || report.valid === 0} onClick={commit}>Commit {report.valid} valid row{report.valid === 1 ? '' : 's'}</button>
                  <div className="muted small" style={{ marginTop: 6 }}>Rejected rows go to quarantine with their evidence. Importing the same file twice changes nothing.</div>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <header><h2>Import history</h2></header>
        {imports.length === 0 ? <div className="muted">No imports in this session.</div> : (
          <table><thead><tr><th>Import</th><th>Dataset</th><th>Version</th><th>Rows</th><th>By</th></tr></thead>
          <tbody>{imports.map((i) => <tr key={i.id}><td className="mono">{i.id}</td><td>{DATASETS.find((d) => d.id === i.dataset)?.label}</td><td>v{i.version}</td><td>{i.rows} ok, {i.rejected} rejected</td><td>{i.by}<div className="muted small">{formatTime(i.at)}</div></td></tr>)}</tbody></table>
        )}
      </section>
    </div>
  )
}

function ReferenceTab() {
  const { conversions, addConversion } = usePipeline()
  const { can } = useAuth()
  const [f, setF] = useState({ from: '', to: '', factor: '', date: '', source: '' })
  const ok = f.from && f.to && Number(f.factor) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(f.date) && f.source
  return (
    <div className="grid two">
      <section className="card">
        <header><h2>Unit and currency conversions</h2><span className="muted small">dated; new rows never overwrite old ones</span></header>
        <table><thead><tr><th>From</th><th>To</th><th>Factor</th><th>Effective</th><th>Source</th></tr></thead>
        <tbody>{conversions.map((c) => <tr key={c.id}><td>{c.from}</td><td>{c.to}</td><td>{c.factor}</td><td>{c.effectiveFrom}</td><td>{c.source}</td></tr>)}</tbody></table>
        {can('reference.edit') ? (
          <div style={{ marginTop: 12 }}>
            <h3>Add a conversion</h3>
            <div className="grid two" style={{ marginTop: 6 }}>
              {(['from', 'to', 'factor', 'date', 'source'] as const).map((k) => (
                <div className="field" key={k}><label htmlFor={`cv-${k}`}>{k === 'date' ? 'Effective from (YYYY-MM-DD)' : k[0].toUpperCase() + k.slice(1)}</label>
                  <input id={`cv-${k}`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
              ))}
            </div>
            <div style={{ marginTop: 8 }}><button className="btn primary" disabled={!ok} onClick={() => { addConversion({ from: f.from, to: f.to, factor: Number(f.factor), effectiveFrom: f.date, source: f.source }); setF({ from: '', to: '', factor: '', date: '', source: '' }) }}>Add conversion</button></div>
          </div>
        ) : <p className="muted small">Only a Data Steward or Admin can add reference data.</p>}
      </section>
      <section className="card">
        <header><h2>Countries and aliases</h2></header>
        <table><thead><tr><th>Code</th><th>Country</th><th>Aliases</th></tr></thead>
        <tbody>{countries.map((c) => <tr key={c.code}><td className="mono">{c.code}</td><td>{c.name}</td><td>{c.aliases.join(', ')}</td></tr>)}</tbody></table>
        <h3 style={{ marginTop: 14 }}>Commodity forms and grades</h3>
        <table><thead><tr><th>Commodity</th><th>Form</th><th>Note</th></tr></thead>
        <tbody>{forms.map((x) => <tr key={x.form}><td>{x.commodity}</td><td>{x.form}</td><td>{x.note}</td></tr>)}</tbody></table>
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
