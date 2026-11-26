import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { PageHead, formatTime } from '../components/ui'
import { SUPPLIERS, SUPPLIER_BY_ID, fmtDate, qualFor, siteOf, type AssetType, type Qualification, type Stage } from '../prototype/data'
import { ALL_FORMS, createSupplier, currentVersion, nameCollision, recordOf, recordQualification, saveSupplier, useMaster, validateLei, type MasterRecord } from '../prototype/master'
import { QualBadge, RepresentativeBadge } from '../prototype/parts'
import { useSelection } from '../prototype/selection'

const tick = (on: boolean, label: string) => <span className={`badge ${on ? 'b-ok' : 'b-neutral'}`} title={on ? `${label} recorded` : `${label} not recorded`}>{label}</span>
const QUAL_OPTIONS: [Qualification, string][] = [['qualified', 'Qualified'], ['pending', 'Pending'], ['not_qualified', 'Not qualified'], ['unknown', 'Unknown']]

function Detail({ id, editable }: { id: string; editable: boolean }) {
  const { user } = useAuth()
  const { requirement } = useSelection()
  const s = SUPPLIER_BY_ID[id]
  const rec: MasterRecord = recordOf(id)
  const site = siteOf(s)
  const [d, setD] = useState({ legalName: rec.legalName, aliases: rec.aliases, lei: rec.lei, regNo: rec.regNo, jurisdiction: rec.jurisdiction, duns: rec.duns, registryId: rec.registryId,
    forms: rec.forms ?? s.forms, siteName: rec.site?.site ?? '', lat: rec.site?.lat != null ? String(rec.site.lat) : '', lon: rec.site?.lon != null ? String(rec.site.lon) : '', owner: rec.site?.owner ?? '', timeline: rec.site?.timeline ?? '' })
  const [alias, setAlias] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [q, setQ] = useState({ form: s.forms[0] ?? 'APT', status: 'qualified' as Qualification, evidence: '', confirmedBy: '', validFrom: '2026-11-26' })
  const [qErr, setQErr] = useState<string | null>(null)
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => { setD((p) => ({ ...p, [k]: v })); setMsg(null) }

  const addAlias = () => {
    const a = alias.trim()
    if (!a) return
    const clash = nameCollision(a, id)
    if (clash) return setErrors([`“${a}” already identifies ${clash}. Resolve the collision in Data review before reusing a name.`])
    if (!d.aliases.includes(a)) set('aliases', [...d.aliases, a])
    setAlias(''); setErrors([])
  }
  const save = () => {
    const errs: string[] = []
    const lei = d.lei.trim().toUpperCase()
    const leiErr = validateLei(lei); if (leiErr) errs.push(leiErr)
    const lat = d.lat.trim() === '' ? undefined : Number(d.lat), lon = d.lon.trim() === '' ? undefined : Number(d.lon)
    if ((lat != null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) || (lon != null && (!Number.isFinite(lon) || lon < -180 || lon > 180))) errs.push('Latitude is −90 to 90 and longitude −180 to 180.')
    if ((lat == null) !== (lon == null)) errs.push('Give both latitude and longitude, or neither.')
    if (!d.forms.length) errs.push('Choose at least one product form.')
    const legalClash = d.legalName.trim() ? nameCollision(d.legalName, id) : null
    if (legalClash) errs.push(`The legal name already identifies ${legalClash}.`)
    setErrors(errs)
    if (errs.length) return
    const site: Record<string, unknown> = {}
    if (d.siteName.trim()) site.site = d.siteName.trim()
    if (lat != null && lon != null) { site.lat = lat; site.lon = lon }
    if (d.owner.trim()) site.owner = d.owner.trim()
    if (d.timeline.trim()) site.timeline = d.timeline.trim()
    const changes = saveSupplier(id, { legalName: d.legalName.trim(), aliases: d.aliases, lei, regNo: d.regNo.trim(), jurisdiction: d.jurisdiction.trim(), duns: d.duns.trim(), registryId: d.registryId.trim(), forms: d.forms, site }, user.name)
    setMsg(changes.length ? `Saved as version ${currentVersion(recordOf(id))}: ${changes.length} change${changes.length === 1 ? '' : 's'} logged.` : 'No changes to save.')
  }
  const record = () => {
    if (q.status === 'qualified' && (!q.evidence.trim() || !q.confirmedBy.trim())) return setQErr('A qualified status needs evidence and the confirming person.')
    if (q.status === 'not_qualified' && !q.confirmedBy.trim()) return setQErr('A not-qualified status needs the confirming person.')
    setQErr(null)
    recordQualification(id, q.form, { status: q.status, evidence: q.evidence.trim(), confirmedBy: q.confirmedBy.trim(), validFrom: q.validFrom, enteredBy: user.name })
    setQ({ ...q, evidence: '', confirmedBy: '' })
  }

  const dis = !editable
  return (
    <>
      <section className="card">
        <header><h2>{s.name}</h2><span className="muted small">{s.country} · {s.assetType}, {s.stage.toLowerCase()} · <Link to={`/suppliers/${id}`}>open profile</Link></span></header>
        {errors.length > 0 && <div className="notice" role="alert">{errors.map((e) => <div key={e}>{e}</div>)}</div>}
        <div className="filters">
          <div className="field"><label htmlFor="m-legal">Legal name</label><input id="m-legal" value={d.legalName} disabled={dis} onChange={(e) => set('legalName', e.target.value)} /></div>
          <div className="field"><label htmlFor="m-lei">LEI</label><input id="m-lei" value={d.lei} disabled={dis} onChange={(e) => set('lei', e.target.value.toUpperCase())} placeholder="20 characters" /></div>
          <div className="field"><label htmlFor="m-reg">Registration number</label><input id="m-reg" value={d.regNo} disabled={dis} onChange={(e) => set('regNo', e.target.value)} /></div>
          <div className="field"><label htmlFor="m-jur">Jurisdiction</label><input id="m-jur" value={d.jurisdiction} disabled={dis} onChange={(e) => set('jurisdiction', e.target.value)} /></div>
          <div className="field"><label htmlFor="m-duns">DUNS (only where the team holds it)</label><input id="m-duns" value={d.duns} disabled={dis} onChange={(e) => set('duns', e.target.value)} /></div>
          <div className="field"><label htmlFor="m-reg-id">Credibl registry record</label><input id="m-reg-id" value={d.registryId} disabled={dis} onChange={(e) => set('registryId', e.target.value)} /></div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label htmlFor="m-alias">Aliases (other names this supplier appears under)</label>
          <div className="row">
            {d.aliases.map((a) => <span key={a} className="chip">{a}{!dis && <button aria-label={`Remove alias ${a}`} onClick={() => set('aliases', d.aliases.filter((x) => x !== a))}>×</button>}</span>)}
            {!d.aliases.length && <span className="muted small">None</span>}
            {!dis && <><input id="m-alias" value={alias} onChange={(e) => setAlias(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addAlias()} placeholder="Add an alias" /><button className="btn" onClick={addAlias}>Add</button></>}
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>Product forms offered</label>
          <div className="row">
            {ALL_FORMS.map((f) => (
              <label key={f} className="row small" style={{ gap: 4 }}>
                <input type="checkbox" checked={d.forms.includes(f)} disabled={dis} onChange={() => set('forms', d.forms.includes(f) ? d.forms.filter((x) => x !== f) : [...d.forms, f])} />{f}
              </label>
            ))}
          </div>
        </div>

        <h3 style={{ margin: '14px 0 6px' }}>Origin and site</h3>
        <div className="filters">
          <div className="field"><label htmlFor="m-site">Site name</label><input id="m-site" value={d.siteName} placeholder={site.site} disabled={dis} onChange={(e) => set('siteName', e.target.value)} /></div>
          <div className="field"><label htmlFor="m-lat">Latitude</label><input id="m-lat" value={d.lat} placeholder={Number.isFinite(site.lat) ? String(site.lat) : ''} disabled={dis} onChange={(e) => set('lat', e.target.value)} /></div>
          <div className="field"><label htmlFor="m-lon">Longitude</label><input id="m-lon" value={d.lon} placeholder={Number.isFinite(site.lon) ? String(site.lon) : ''} disabled={dis} onChange={(e) => set('lon', e.target.value)} /></div>
          <div className="field"><label htmlFor="m-own">Ownership</label><input id="m-own" value={d.owner} placeholder={site.owner} disabled={dis} onChange={(e) => set('owner', e.target.value)} /></div>
          <div className="field"><label htmlFor="m-time">Timeline</label><input id="m-time" value={d.timeline} placeholder={site.timeline} disabled={dis} onChange={(e) => set('timeline', e.target.value)} /></div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" onClick={save} disabled={dis}>Save changes</button>
          {msg && <span className="ok-text small" role="status">{msg}</span>}
          {dis && <span className="muted small">Your role can view but not change the Supplier Master.</span>}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>Scores, sanctions screening and registry facts come from Credibl and are not edited here. Which identifiers are mandatory is still to be agreed; a supplier with none is matched by name and goes to Data review if the name is uncertain.</p>
      </section>

      <section className="card">
        <header><h2>Qualification by product form</h2><span className="muted small">Confirmed by the client’s Engineering/Quality Lead; entered by the delivery team</span></header>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Form</th><th>Status</th><th>Evidence</th><th>Confirmed by</th><th>Valid from</th><th>Entered by</th></tr></thead>
            <tbody>
              {(rec.forms ?? s.forms).map((f) => {
                const r = rec.qualifications[f]
                return (
                  <tr key={f}>
                    <td>{f}{f === requirement.form && <span className="muted small"> (current requirement)</span>}</td>
                    <td><QualBadge value={qualFor(s, f)} /></td>
                    <td className="small">{r ? r.evidence || '–' : <span className="muted">{f === 'APT' && s.qualification !== 'unknown' ? 'Registry status; no evidence recorded' : 'Not recorded'}</span>}</td>
                    <td className="small">{r ? r.confirmedBy || '–' : '–'}</td>
                    <td className="small">{r ? fmtDate(r.validFrom) : '–'}</td>
                    <td className="small">{r ? `${r.enteredBy}, ${formatTime(r.enteredAt)}` : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!dis && (
          <>
            <h3 style={{ margin: '14px 0 6px' }}>Record or change a qualification</h3>
            <div className="filters">
              <div className="field"><label htmlFor="q-form">Product form</label>
                <select id="q-form" value={q.form} onChange={(e) => setQ({ ...q, form: e.target.value })}>{(rec.forms ?? s.forms).map((f) => <option key={f}>{f}</option>)}</select></div>
              <div className="field"><label htmlFor="q-status">Status</label>
                <select id="q-status" value={q.status} onChange={(e) => setQ({ ...q, status: e.target.value as Qualification })}>{QUAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              <div className="field"><label htmlFor="q-ev">Evidence (reference)</label><input id="q-ev" value={q.evidence} onChange={(e) => setQ({ ...q, evidence: e.target.value })} placeholder="Certificate or report" /></div>
              <div className="field"><label htmlFor="q-by">Confirmed by (named person)</label><input id="q-by" value={q.confirmedBy} onChange={(e) => setQ({ ...q, confirmedBy: e.target.value })} /></div>
              <div className="field"><label htmlFor="q-date">Valid from</label><input id="q-date" type="date" value={q.validFrom} onChange={(e) => setQ({ ...q, validFrom: e.target.value })} /></div>
              <div className="field"><label>&nbsp;</label><button className="btn primary" onClick={record}>Record</button></div>
            </div>
            {qErr && <p className="bad-text small" role="alert">{qErr}</p>}
          </>
        )}
      </section>

      <section className="card">
        <header><h2>Version history</h2><span className="muted small">{rec.versions.length} version{rec.versions.length === 1 ? '' : 's'}</span></header>
        {rec.versions.length === 0 ? <div className="empty">No changes recorded yet. The preloaded representative record is unchanged.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Version</th><th>When</th><th>Who</th><th>Changes</th></tr></thead>
              <tbody>{rec.versions.map((v) => <tr key={v.version}><td>v{v.version}</td><td>{formatTime(v.at)}</td><td>{v.by}</td><td className="small">{v.changes.map((c) => <div key={c}>{c}</div>)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function NewSupplier({ prefill, onDone, onCancel }: { prefill: string; onDone: (id: string) => void; onCancel: () => void }) {
  const { user } = useAuth()
  const [f, setF] = useState({ name: prefill, legalName: '', country: '', assetType: 'Mine' as AssetType, stage: 'Producing' as Stage, forms: ['APT'] as string[], capacity: '' })
  const [errs, setErrs] = useState<string[]>([])
  const create = () => {
    const e: string[] = []
    if (!f.name.trim()) e.push('Enter the supplier name.')
    const clash = f.name.trim() ? nameCollision(f.name) : null
    if (clash) e.push(`This name already identifies ${clash}. Open that record or add the name as an alias.`)
    if (!f.country.trim()) e.push('Enter the country of origin.')
    if (!f.forms.length) e.push('Choose at least one product form.')
    const cap = f.capacity.trim() === '' ? null : Number(f.capacity)
    if (cap != null && (!Number.isFinite(cap) || cap < 0)) e.push('Capacity must be a positive number of tonnes per year, or empty if not disclosed.')
    setErrs(e)
    if (e.length) return
    onDone(createSupplier({ name: f.name, legalName: f.legalName, country: f.country, assetType: f.assetType, stage: f.stage, forms: f.forms, capacityT: cap }, user.name))
  }
  return (
    <section className="card">
      <header><h2>Add a supplier</h2><button className="btn" onClick={onCancel}>Cancel</button></header>
      {errs.length > 0 && <div className="notice" role="alert">{errs.map((e) => <div key={e}>{e}</div>)}</div>}
      <div className="filters">
        <div className="field"><label htmlFor="n-name">Supplier name</label><input id="n-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="field"><label htmlFor="n-legal">Legal name</label><input id="n-legal" value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></div>
        <div className="field"><label htmlFor="n-country">Country of origin</label><input id="n-country" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} /></div>
        <div className="field"><label htmlFor="n-type">Asset type</label><select id="n-type" value={f.assetType} onChange={(e) => setF({ ...f, assetType: e.target.value as AssetType })}>{['Mine', 'Refinery', 'Project'].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label htmlFor="n-stage">Stage</label><select id="n-stage" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as Stage })}>{['Producing', 'Ramp-up', 'Development', 'Exploration'].map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label htmlFor="n-cap">Capacity (t/yr, if disclosed)</label><input id="n-cap" value={f.capacity} onChange={(e) => setF({ ...f, capacity: e.target.value })} /></div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <span className="small muted">Product forms:</span>
        {ALL_FORMS.map((x) => <label key={x} className="row small" style={{ gap: 4 }}><input type="checkbox" checked={f.forms.includes(x)} onChange={() => setF({ ...f, forms: f.forms.includes(x) ? f.forms.filter((y) => y !== x) : [...f.forms, x] })} />{x}</label>)}
        <span style={{ flex: 1 }} /><button className="btn primary" onClick={create}>Create supplier</button>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>A new supplier has no Credibl scores and sanctions screening is pending, so it shows as not cleared and is not ranked until data and screening arrive.</p>
    </section>
  )
}

export function SupplierMaster() {
  const { can } = useAuth()
  const { requirement } = useSelection()
  useMaster()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const editable = can('master.edit')
  const sel = params.get('s')
  const adding = params.get('new') === '1'
  const open = (id: string | null) => setParams(id ? { s: id } : {})

  const rows = SUPPLIERS.filter((s) => !q || `${s.name} ${s.country} ${recordOf(s.id).aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="page">
      <PageHead title="Supplier master">
        Maintain supplier identities, aliases, identifiers, registry links and qualification by product form. Every change is versioned with who made it.
      </PageHead>
      <div className="row"><RepresentativeBadge /><span className="muted small">Prototype. This is the maintained record the comparison and quote matching use; it is not full master data management (no merging or hierarchies).</span></div>

      {adding && editable && <NewSupplier prefill={params.get('name') ?? ''} onCancel={() => open(null)} onDone={(id) => open(id)} />}

      <section className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="field"><label htmlFor="ms-q">Search</label><input id="ms-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, country or alias" /></div>
          <span style={{ flex: 1 }} />
          {editable && <button className="btn primary" onClick={() => setParams({ new: '1' })}>Add supplier</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Supplier</th><th>Country</th><th>Identifiers</th><th>Aliases</th><th>Registry link</th><th>Forms</th><th>Qualification ({requirement.form})</th><th>Version</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const r = recordOf(s.id)
                return (
                  <tr key={s.id} className={sel === s.id ? 'sel' : ''}>
                    <td><button className="linkbtn" onClick={() => open(s.id)}>{s.name}</button>{r.created && <> <span className="badge b-live">Added</span></>}</td>
                    <td>{s.country}</td>
                    <td><span className="row" style={{ gap: 4 }}>{tick(!!r.lei, 'LEI')}{tick(!!r.regNo, 'Reg.')}{tick(!!r.duns, 'DUNS')}</span></td>
                    <td>{r.aliases.length || <span className="muted">0</span>}</td>
                    <td className="small">{r.registryId || <span className="badge b-warn">Not linked</span>}</td>
                    <td className="small">{s.forms.join(', ')}</td>
                    <td><QualBadge value={qualFor(s, requirement.form)} /></td>
                    <td>v{currentVersion(r)}</td>
                  </tr>
                )
              })}
              {!rows.length && <tr><td colSpan={8} className="empty">No supplier matches.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {sel && SUPPLIER_BY_ID[sel] && <Detail key={sel} id={sel} editable={editable} />}
      {!sel && !adding && <p className="muted small">Choose a supplier to see and edit its record.</p>}
    </div>
  )
}
