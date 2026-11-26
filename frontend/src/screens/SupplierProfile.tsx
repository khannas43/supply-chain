import { Link, useParams } from 'react-router-dom'
import { PageHead } from '../components/ui'
import {
  CONFIG, DIMS, qualFor, siteOf, SUPPLIER_BY_ID, completeness, dashboardRatings, fmtDate, headline, isEmerging, ratingOf, dimensionScore,
} from '../prototype/data'
import { CostBuildUp, MetricTable, QualBadge, RagBadge, RepresentativeBadge, SanctionsBadge, rmiLabel } from '../prototype/parts'
import { useSelection } from '../prototype/selection'

const REGISTRY = { source: 'Credibl producer and asset registry (C-05)', asOf: '2026-07-28' }

export function SupplierProfile() {
  const { id = '' } = useParams()
  const { selected, add, remove, limit, atLimit, requirement } = useSelection()
  const s = SUPPLIER_BY_ID[id]
  if (!s) {
    return (
      <div className="page">
        <PageHead title="Supplier not found">There is no supplier with this identifier in the registry.</PageHead>
        <div><Link to="/suppliers" className="btn">Back to the supplier dashboard</Link></div>
      </div>
    )
  }
  const site = siteOf(s)
  const on = selected.includes(s.id)
  const r = dashboardRatings(s)
  const comp = Math.round(completeness(s) * 100)

  const rows: { item: string; value: React.ReactNode; source: string; asOf: string | null }[] = [
    { item: 'Asset type and stage', value: <>{s.assetType}, {s.stage.toLowerCase()}{isEmerging(s) && <> <span className="badge b-live">Emerging</span></>}</>, source: REGISTRY.source, asOf: REGISTRY.asOf },
    { item: 'Origin', value: <>{site.site}, {s.country} {Number.isFinite(site.lat) && <span className="muted small">({site.lat.toFixed(2)}, {site.lon.toFixed(2)})</span>}</>, source: REGISTRY.source, asOf: REGISTRY.asOf },
    { item: 'Capacity', value: s.capacityT != null ? `${s.capacityT.toLocaleString('en-GB')} t APT-equivalent per year` : <span className="muted">Not disclosed</span>, source: 'Company filings and technical reports (listed producers only)', asOf: s.capacityT != null ? '2026-07-28' : null },
    { item: 'Timeline', value: site.timeline, source: REGISTRY.source, asOf: REGISTRY.asOf },
    { item: 'Ownership', value: <>{site.owner} <span className="muted small">Ownership exposure: not screened</span></>, source: REGISTRY.source, asOf: REGISTRY.asOf },
    { item: 'Product forms', value: s.forms.join(', '), source: REGISTRY.source, asOf: REGISTRY.asOf },
    { item: `Qualification (${requirement.form})`, value: <QualBadge value={qualFor(s, requirement.form)} />, source: 'Client Engineering/Quality Lead, recorded in the Supplier Master', asOf: qualFor(s, requirement.form) === 'unknown' ? null : '2026-11-12' },
    { item: 'Sanctions screening', value: <SanctionsBadge value={s.sanctions} />, source: 'Credibl supplier screening (C-09), named entities only', asOf: '2026-11-24' },
    { item: 'RMI smelter status', value: rmiLabel(s.rmi), source: 'RMI conformant smelter list (owner and licence to be confirmed)', asOf: s.rmi === 'unknown' ? null : '2026-10-31' },
  ]

  return (
    <div className="page">
      <div className="row small"><Link to="/suppliers">← Supplier dashboard</Link></div>
      <PageHead title={s.name}>
        {s.country} · {s.assetType}, {s.stage.toLowerCase()}
        {s.note ? `. ${s.note}` : ''}
      </PageHead>
      <div className="row">
        <RepresentativeBadge />
        {isEmerging(s) && <span className="badge b-live">Emerging supplier</span>}
        <RagBadge rating={headline(s)} />
        <span className="muted small">headline rating</span>
        <span style={{ flex: 1 }} />
        {on
          ? <button className="btn" onClick={() => remove(s.id)}>Remove from comparison</button>
          : <button className="btn primary" onClick={() => add(s.id)} disabled={atLimit} title={atLimit ? `Limit of ${limit} suppliers reached` : undefined}>Add to comparison</button>}
        {on && <Link to="/comparison" className="btn">Open comparison</Link>}
      </div>

      <div className="grid tiles">
        {([['Supply security', r.security], ['Logistics', r.logistics], ['Geopolitical and regulatory', r.geo]] as const).map(([label, rating]) => (
          <div className="tile" key={label}><h3>{label}</h3><div style={{ margin: '4px 0' }}><RagBadge rating={rating} /></div><div className="sub">Indicative; 1 = most favourable, green below {CONFIG.greenBelow}, red above {CONFIG.redAbove}</div></div>
        ))}
        <div className="tile"><h3>Data completeness</h3><div className="big">{comp}%</div><div className="sub">of applicable metrics have data. Ranking needs {CONFIG.minCoverage * 100}%.</div></div>
      </div>

      <section className="card">
        <header><h2>Status, origin and ownership</h2><span className="muted small">Unknown fields stay unknown</span></header>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Item</th><th>Value</th><th>Source</th><th>As of</th></tr></thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.item}>
                  <td>{x.item}</td><td>{x.value}</td><td className="small">{x.source}</td>
                  <td className="small">{x.asOf ? fmtDate(x.asOf) : <span className="badge b-neutral">No date: unknown</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>Capacity and mine life come from filings and are refreshed annually; most Chinese producers do not disclose them. Supplier-specific commercial fields come from the client or labelled representative data.</p>
      </section>

      <section className="card">
        <header><h2>Risk profile</h2><span className="muted small">Average per dimension: {DIMS.filter((d) => d.id !== 'price').map((d) => `${d.short} ${dimensionScore(s, d.id, requirement.volumeT)?.toFixed(1) ?? '–'}`).join(' · ')}</span></header>
        {DIMS.filter((d) => d.id !== 'price').map((d) => {
          const v = dimensionScore(s, d.id, requirement.volumeT)
          return (
            <div key={d.id} style={{ marginBottom: 14 }}>
              <div className="row" style={{ marginBottom: 6 }}><strong>{d.label}</strong><RagBadge rating={ratingOf(v)} score={v} /></div>
              <MetricTable s={s} dim={d.id} />
            </div>
          )
        })}
      </section>

      <CostBuildUp s={s} />
      <p className="muted small" style={{ marginTop: -8 }}>
        Cost for the current requirement ({requirement.volumeT} t {requirement.form}); <Link to="/requirement">edit the requirement</Link>.
      </p>
    </div>
  )
}
