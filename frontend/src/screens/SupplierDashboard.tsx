import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageHead, Tabs } from '../components/ui'
import {
  SUPPLIERS, qualFor, completeness, dashboardRatings, headline, isEmerging,
  type Rating, type Supplier,
} from '../prototype/data'
import { QualBadge, RagBadge, RepresentativeBadge, SanctionsBadge } from '../prototype/parts'
import { MapLegend, SupplierMap } from '../prototype/SupplierMap'
import { useSelection } from '../prototype/selection'

type SortKey = 'name' | 'country' | 'capacity' | 'completeness' | 'rating'
const RATING_ORDER: Record<Rating, number> = { red: 0, amber: 1, green: 2, unknown: 3 }

const uniq = (xs: string[]) => [...new Set(xs)].sort()
const ANY = 'any'

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value={ANY}>All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}

export function SupplierDashboard() {
  const { selected, limit, toggle, clear, atLimit, requirement } = useSelection()
  const navigate = useNavigate()
  const [view, setView] = useState<'list' | 'map'>('list')
  const [f, setF] = useState({ q: '', country: ANY, stage: ANY, emerging: ANY, form: ANY, asset: ANY, rating: ANY, sanctions: ANY, capacity: ANY })
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 })
  const set = (k: keyof typeof f) => (v: string) => setF((p) => ({ ...p, [k]: v }))

  const rows = useMemo(() => {
    const list = SUPPLIERS.filter((s) => {
      if (f.q && !`${s.name} ${s.country}`.toLowerCase().includes(f.q.toLowerCase())) return false
      if (f.country !== ANY && s.country !== f.country) return false
      if (f.stage !== ANY && s.stage !== f.stage) return false
      if (f.emerging !== ANY && (f.emerging === 'yes') !== isEmerging(s)) return false
      if (f.form !== ANY && !s.forms.includes(f.form)) return false
      if (f.asset !== ANY && s.assetType !== f.asset) return false
      if (f.rating !== ANY && headline(s) !== f.rating) return false
      if (f.sanctions !== ANY && s.sanctions !== f.sanctions) return false
      if (f.capacity === 'covers' && !(s.capacityT != null && s.capacityT >= requirement.volumeT)) return false
      if (f.capacity === 'below' && !(s.capacityT != null && s.capacityT < requirement.volumeT)) return false
      if (f.capacity === 'undisclosed' && s.capacityT != null) return false
      return true
    })
    const val = (s: Supplier): number | string =>
      sort.key === 'name' ? s.name : sort.key === 'country' ? s.country : sort.key === 'capacity' ? (s.capacityT ?? -1)
        : sort.key === 'completeness' ? completeness(s) : RATING_ORDER[headline(s)]
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b)
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [f, sort, requirement.volumeT])

  const flagged = SUPPLIERS.filter((s) => s.sanctions !== 'clear' || s.rmi === 'not_conformant').length
  const emerging = SUPPLIERS.filter(isEmerging)
  const th = (key: SortKey, label: string) => (
    <th aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button className="thbtn" onClick={() => setSort((p) => ({ key, dir: p.key === key ? (p.dir === 1 ? -1 : 1) : 1 }))}>
        {label}{sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  )

  return (
    <div className="page">
      <PageHead title="Supplier dashboard">
        Every tungsten producer, refiner and project in the registry, with indicative ratings. Select suppliers to compare; the selection carries over to the comparison.
      </PageHead>
      <div className="row"><RepresentativeBadge /><span className="muted small">Prototype for buyer review. Logistics rating, qualification and the sanctions filter arrive in Sprint 2 and are shown so the layout can be judged; ratings are indicative until quotes are loaded. Switch between the list and the map below.</span></div>

      <div className="grid tiles">
        <div className="tile"><h3>Suppliers in registry</h3><div className="big">{SUPPLIERS.length}</div><div className="sub">{rows.length} match the filters</div></div>
        <div className="tile"><h3>Emerging suppliers</h3><div className="big">{emerging.length}</div><div className="sub">Asset at exploration, development or ramp-up stage (definition to be confirmed with Credibl)</div></div>
        <div className="tile"><h3>Sanctions or RMI flags</h3><div className="big">{flagged}</div><div className="sub">These would be excluded or held for review in a comparison</div></div>
        <div className="tile">
          <h3>Selected for comparison</h3>
          <div className={selected.length > limit ? 'big bad-text' : 'big'}>{selected.length} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>of {limit}</span></div>
          {selected.length > limit && <div className="small bad-text" role="alert">Over the limit by {selected.length - limit}; remove suppliers to compare.</div>}
          <div className="row">
            <Link to="/requirement" className="btn primary">Continue</Link>
            <button className="btn" onClick={clear} disabled={!selected.length}>Clear</button>
            <Link to="/configuration" className="small" title="The limit is a setting">Change limit</Link>
          </div>
        </div>
      </div>

      <section className="card">
        <div className="filters">
          <div className="field"><label>Search</label><input value={f.q} onChange={(e) => set('q')(e.target.value)} placeholder="Name or country" /></div>
          <Filter label="Country" value={f.country} onChange={set('country')} options={uniq(SUPPLIERS.map((s) => s.country)).map((c) => [c, c])} />
          <Filter label="Stage" value={f.stage} onChange={set('stage')} options={['Producing', 'Ramp-up', 'Development', 'Exploration'].map((c) => [c, c])} />
          <Filter label="Emerging" value={f.emerging} onChange={set('emerging')} options={[['yes', 'Emerging only'], ['no', 'Established only']]} />
          <Filter label="Product form" value={f.form} onChange={set('form')} options={uniq(SUPPLIERS.flatMap((s) => s.forms)).map((c) => [c, c])} />
          <Filter label="Asset type" value={f.asset} onChange={set('asset')} options={['Mine', 'Refinery', 'Project'].map((c) => [c, c])} />
          <Filter label="Headline rating" value={f.rating} onChange={set('rating')} options={[['green', 'Green'], ['amber', 'Amber'], ['red', 'Red'], ['unknown', 'Unknown']]} />
          <Filter label="Sanctions" value={f.sanctions} onChange={set('sanctions')} options={[['clear', 'Clear'], ['review', 'Review'], ['match', 'Match']]} />
          <Filter label={`Capacity vs ${requirement.volumeT} t required`} value={f.capacity} onChange={set('capacity')} options={[['covers', 'Covers volume'], ['below', 'Below volume'], ['undisclosed', 'Not disclosed']]} />
          <div className="field"><label>&nbsp;</label><button className="btn" onClick={() => setF({ q: '', country: ANY, stage: ANY, emerging: ANY, form: ANY, asset: ANY, rating: ANY, sanctions: ANY, capacity: ANY })}>Reset filters</button></div>
        </div>
      </section>

      <div className="row"><Tabs tabs={[{ id: 'list', label: 'List' }, { id: 'map', label: 'Map' }]} value={view} onChange={setView} /><span className="muted small">{rows.length} of {SUPPLIERS.length} suppliers, following the filters above</span></div>

      {view === 'map' && (
        <section className="card">
          {rows.length ? <SupplierMap suppliers={rows} onOpen={(id) => navigate(`/suppliers/${id}`)} /> : <div className="empty">No supplier matches these filters.</div>}
          <MapLegend />
        </section>
      )}

      {view === 'list' && <section className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th><span className="sr-only">Select</span></th>
                {th('name', 'Supplier')}{th('country', 'Country')}
                <th>Asset and stage</th>
                {th('capacity', 'Capacity (t/yr)')}
                <th>Qualification ({requirement.form})</th><th>Sanctions</th>
                <th>Supply security</th><th>Logistics</th><th>Geo & regulatory</th>
                {th('rating', 'Headline')}{th('completeness', 'Data')}
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const r = dashboardRatings(s)
                const on = selected.includes(s.id)
                const blocked = !on && atLimit
                return (
                  <tr key={s.id} className={on ? 'sel' : ''}>
                    <td>
                      <input type="checkbox" checked={on} disabled={blocked} onChange={() => toggle(s.id)}
                        aria-label={`Select ${s.name} for comparison`} title={blocked ? `Limit of ${limit} suppliers reached` : undefined} />
                    </td>
                    <td>
                      <Link to={`/suppliers/${s.id}`}>{s.name}</Link>
                      {isEmerging(s) && <> <span className="badge b-live" title="Emerging supplier">Emerging</span></>}
                    </td>
                    <td>{s.country}</td>
                    <td>{s.assetType}<div className="muted small">{s.stage}</div></td>
                    <td>{s.capacityT != null ? s.capacityT.toLocaleString('en-GB') : <span className="muted">Not disclosed</span>}</td>
                    <td><QualBadge value={qualFor(s, requirement.form)} /></td>
                    <td><SanctionsBadge value={s.sanctions} /></td>
                    <td><RagBadge rating={r.security} /></td>
                    <td><RagBadge rating={r.logistics} /></td>
                    <td><RagBadge rating={r.geo} /></td>
                    <td><RagBadge rating={headline(s)} /></td>
                    <td>
                      <span className="bar" title={`${Math.round(completeness(s) * 100)}% of metrics have data`}><i style={{ width: `${completeness(s) * 48}px` }} />{Math.round(completeness(s) * 100)}%</span>
                    </td>
                  </tr>
                )
              })}
              {!rows.length && <tr><td colSpan={12} className="empty">No supplier matches these filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Ratings: green below 2.5, red above 3.5 on a 1 to 5 scale where 1 is most favourable. Headline is the worst of the three. “Unknown” means no data, never a good score.
          Open a supplier for the source and date behind each item.
        </p>
      </section>}
    </div>
  )
}
