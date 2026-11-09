import { Link } from 'react-router-dom'
import { useApi } from '../api/hooks'
import { useApp } from '../components/AppContext'
import { Loaded } from '../components/Remote'
import { ModeBadge, PageHead, STATE_BADGE, SeverityBadge, formatTime } from '../components/ui'
import type { Confidence, Mode, Severity } from '../data/types'

const SEV: Severity[] = ['critical', 'high', 'medium', 'low']
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const label = (s: string) => cap(s.replace(/_/g, ' '))

function Bar({ value, max, warn }: { value: number; max: number; warn?: boolean }) {
  return (
    <span className={`bar${warn ? ' warn' : ''}`}>
      <i style={{ width: `${max ? Math.max(2, (100 * value) / max) : 0}%`, maxWidth: 160 }} />
      {value}
    </span>
  )
}

function Tiles({ items }: { items: { title: string; value: number | string; note?: string }[] }) {
  return (
    <div className="grid tiles">
      {items.map((t) => (
        <div key={t.title} className="tile">
          <h3>{t.title}</h3>
          <div className="big">{t.value}</div>
          {t.note && <div className="sub">{t.note}</div>}
        </div>
      ))}
    </div>
  )
}

const AsOf = ({ at }: { at: string }) => <p className="muted small">As of {formatTime(at)}. Figures are read from the data held now; nothing is estimated here.</p>

// ---- R1 ----

interface RiskExposure {
  asOf: string
  totals: { activeAlerts: number; assessed: number; unassessed: number }
  bySeverity: ({ commodity: string } & Record<Severity, number>)[]
  byAssessmentStatus: { status: string; count: number }[]
  byLocation: { commodity: string; location: string; alerts: number; exposedNodes: number }[]
  topAlerts: {
    id: string; commodity: string; title: string; severity: Severity; confidence: Confidence; mode: Mode; location: string
    exposedNodes: number; assessmentStatus: string; disposition: string; exposedValue: number | null; exposedUnit: string | null
  }[]
}

export function RiskExposureReport() {
  const r = useApi<RiskExposure>('/reports/risk-exposure')
  return (
    <div className="page">
      <PageHead title="Risk exposure">Where open risk sits, by severity and place, and how far it has been assessed. Volumes are shown per alert and never added together.</PageHead>
      <Loaded remote={r}>{(d) => (
        <>
          <Tiles items={[
            { title: 'Active alerts', value: d.totals.activeAlerts, note: 'dismissed alerts excluded' },
            { title: 'Assessed', value: d.totals.assessed, note: 'have a calculated snapshot' },
            { title: 'Not yet assessed', value: d.totals.unassessed, note: 'no figure is not zero exposure' },
          ]} />
          <div className="grid two">
            <section className="card">
              <header><h2>Alerts by severity</h2></header>
              <div className="table-wrap"><table>
                <thead><tr><th>Commodity</th>{SEV.map((s) => <th key={s}>{cap(s)}</th>)}</tr></thead>
                <tbody>{d.bySeverity.map((row) => (
                  <tr key={row.commodity}><td>{cap(row.commodity)}</td>{SEV.map((s) => <td key={s}>{row[s]}</td>)}</tr>
                ))}</tbody>
              </table></div>
            </section>
            <section className="card">
              <header><h2>Assessment progress</h2></header>
              <div className="table-wrap"><table>
                <thead><tr><th>Status</th><th>Alerts</th></tr></thead>
                <tbody>{d.byAssessmentStatus.map((s) => (
                  <tr key={s.status}><td>{label(s.status)}</td><td><Bar value={s.count} max={d.totals.activeAlerts} /></td></tr>
                ))}</tbody>
              </table></div>
            </section>
          </div>
          <section className="card">
            <header><h2>By location</h2></header>
            <div className="table-wrap"><table>
              <thead><tr><th>Location</th><th>Commodity</th><th>Alerts</th><th>Nodes matched</th></tr></thead>
              <tbody>{d.byLocation.map((l) => (
                <tr key={l.commodity + l.location}><td>{l.location}</td><td>{cap(l.commodity)}</td><td>{l.alerts}</td><td>{l.exposedNodes}</td></tr>
              ))}</tbody>
            </table></div>
          </section>
          <section className="card">
            <header><h2>Most serious alerts</h2><span className="muted small">top 10 by severity, then newest</span></header>
            <div className="table-wrap"><table>
              <thead><tr><th>Alert</th><th>Severity</th><th>Mode</th><th>Nodes matched</th><th>Exposed</th></tr></thead>
              <tbody>{d.topAlerts.map((a) => (
                <tr key={a.id}>
                  <td><Link to={`/risk?alert=${a.id}`}>{a.title}</Link><div className="muted small">{cap(a.commodity)} · {a.location}</div></td>
                  <td><SeverityBadge value={a.severity} /></td>
                  <td><ModeBadge mode={a.mode} /></td>
                  <td>{a.exposedNodes}</td>
                  <td>{a.exposedValue != null ? `${a.exposedValue.toLocaleString('en-GB')} ${a.exposedUnit}` : <span className="muted">not assessed</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          </section>
          <AsOf at={d.asOf} />
        </>
      )}</Loaded>
    </div>
  )
}

// ---- R2 ----

interface Concentration {
  commodity: string
  totals: { nodes: number; links: number; countries: number; uncertainLinks: number; singleSourceNodes: number }
  byCountry: { country: string; nodes: number; share: number; kinds: Record<string, number> }[]
  byKind: { kind: string; count: number }[]
  linkConfidence: { confidence: string; count: number }[]
  singleSource: { node: string; kind: string; country: string; supplier: string; supplierCountry: string; confidence: string; uncertain: boolean }[]
}

export function ConcentrationReport() {
  const { commodity } = useApp()
  const r = useApi<Concentration>(`/reports/supplier-concentration?commodity=${commodity}`)
  return (
    <div className="page">
      <PageHead title={`Supplier concentration: ${commodity}`}>
        How dependent the network is on single countries and single links. Uses current links only. Use the commodity switch above to change commodity.
      </PageHead>
      <Loaded remote={r}>{(d) => (
        <>
          <Tiles items={[
            { title: 'Nodes', value: d.totals.nodes, note: `${d.totals.countries} countries` },
            { title: 'Links', value: d.totals.links, note: `${d.totals.uncertainLinks} flagged uncertain` },
            { title: 'Single-source nodes', value: d.totals.singleSourceNodes, note: 'one current supplier only' },
          ]} />
          <div className="grid two">
            <section className="card">
              <header><h2>Nodes by country</h2><span className="muted small">top 12</span></header>
              <div className="table-wrap"><table>
                <thead><tr><th>Country</th><th>Nodes</th><th>Share</th></tr></thead>
                <tbody>{d.byCountry.map((c) => (
                  <tr key={c.country}>
                    <td>{c.country}<div className="muted small">{Object.entries(c.kinds).map(([k, n]) => `${n} ${k}`).join(', ')}</div></td>
                    <td>{c.nodes}</td>
                    <td><Bar value={c.share} max={Math.max(...d.byCountry.map((x) => x.share))} warn={c.share >= 25} />%</td>
                  </tr>
                ))}</tbody>
              </table></div>
            </section>
            <section className="card">
              <header><h2>Network make-up</h2></header>
              <div className="table-wrap"><table>
                <thead><tr><th>Kind</th><th>Nodes</th></tr></thead>
                <tbody>{d.byKind.map((k) => <tr key={k.kind}><td>{label(k.kind)}</td><td>{k.count}</td></tr>)}</tbody>
              </table></div>
              <div className="table-wrap"><table>
                <thead><tr><th>Link confidence</th><th>Links</th></tr></thead>
                <tbody>{d.linkConfidence.map((k) => <tr key={k.confidence}><td>{cap(k.confidence)}</td><td>{k.count}</td></tr>)}</tbody>
              </table></div>
            </section>
          </div>
          <section className="card">
            <header><h2>Single-source nodes</h2><span className="muted small">losing the one supplier leaves no alternative on record</span></header>
            {d.singleSource.length === 0 ? <div className="empty">No node depends on one supplier.</div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Node</th><th>Country</th><th>Only supplier</th><th>Link confidence</th></tr></thead>
                <tbody>{d.singleSource.map((s) => (
                  <tr key={s.node}>
                    <td>{s.node}<div className="muted small">{label(s.kind)}</div></td>
                    <td>{s.country}</td>
                    <td>{s.supplier}<div className="muted small">{s.supplierCountry}</div></td>
                    <td>{cap(s.confidence)}{s.uncertain && <span className="badge b-warn" style={{ marginLeft: 6 }}>Uncertain</span>}</td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </>
      )}</Loaded>
    </div>
  )
}

// ---- R3 ----

interface ActionReport {
  asOf: string
  totals: { actions: number; open: number; overdue: number; reviewNeeded: number; done: number }
  byStatus: { status: string; count: number }[]
  byOwner: { owner: string; total: number; open: number; overdue: number }[]
  attention: { id: string; commodity: string; alertId: string; owner: string; status: string; targetDate: string; daysLate: number; reviewNeeded: boolean; assumptionPending: boolean }[]
}

export function ActionsReport() {
  const r = useApi<ActionReport>('/reports/actions')
  return (
    <div className="page">
      <PageHead title="Actions and decisions">Progress and ownership of decisions, and which ones are late or rest on an assessment that has since changed.</PageHead>
      <Loaded remote={r}>{(d) => (
        <>
          <Tiles items={[
            { title: 'Open actions', value: d.totals.open, note: `${d.totals.done} done of ${d.totals.actions}` },
            { title: 'Overdue', value: d.totals.overdue, note: 'past target date, not done' },
            { title: 'Need review', value: d.totals.reviewNeeded, note: 'assessment changed after the decision' },
          ]} />
          <div className="grid two">
            <section className="card">
              <header><h2>By status</h2></header>
              <div className="table-wrap"><table>
                <thead><tr><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{d.byStatus.map((s) => <tr key={s.status}><td>{label(s.status)}</td><td><Bar value={s.count} max={d.totals.actions} /></td></tr>)}</tbody>
              </table></div>
            </section>
            <section className="card">
              <header><h2>By owner</h2></header>
              <div className="table-wrap"><table>
                <thead><tr><th>Owner</th><th>Open</th><th>Overdue</th><th>Total</th></tr></thead>
                <tbody>{d.byOwner.map((o) => (
                  <tr key={o.owner}><td>{o.owner}</td><td>{o.open}</td><td>{o.overdue ? <span className="bad-text">{o.overdue}</span> : 0}</td><td>{o.total}</td></tr>
                ))}</tbody>
              </table></div>
            </section>
          </div>
          <section className="card">
            <header><h2>Needs attention</h2></header>
            {d.attention.length === 0 ? <div className="empty">Nothing is late or out of date.</div> : (
              <div className="table-wrap"><table>
                <thead><tr><th>Action</th><th>Owner</th><th>Status</th><th>Target</th><th>Why</th></tr></thead>
                <tbody>{d.attention.map((a) => (
                  <tr key={a.id}>
                    <td><Link to="/actions">{a.id}</Link><div className="muted small">{cap(a.commodity)} · {a.alertId}</div></td>
                    <td>{a.owner}</td>
                    <td>{label(a.status)}</td>
                    <td>{a.targetDate}</td>
                    <td>
                      {a.daysLate > 0 && <span className="badge b-bad">{a.daysLate} days late</span>}{' '}
                      {a.reviewNeeded && <span className="badge b-warn">Assessment changed</span>}{' '}
                      {a.assumptionPending && <span className="badge b-neutral">Assumption awaiting approval</span>}
                    </td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
          <AsOf at={d.asOf} />
        </>
      )}</Loaded>
    </div>
  )
}

// ---- R4 ----

interface Lifecycle {
  asOf: string
  funnel: { step: string; count: number }[]
  observationOutcomes: { outcome: string; count: number }[]
  runTotals: { accepted: number; duplicate: number; quarantined: number }
  quarantine: { status: string; count: number }[]
  deadLetters: number
  evidenceStored: number
  sources: { id: string; name: string; mode: Mode; state: keyof typeof STATE_BADGE; hoursSinceUsable: number | null; policyHours: number }[]
  integrity: { check: string; violations: number }[] | null
}

export function LifecycleReport() {
  const r = useApi<Lifecycle>('/reports/data-lifecycle')
  return (
    <div className="page">
      <PageHead title="Data life cycle">The path from a source to a decision, how much stands at each step, and whether the rules that tie the steps together hold. Any violation is a data problem to fix.</PageHead>
      <Loaded remote={r}>{(d) => {
        const top = Math.max(...d.funnel.map((f) => f.count), 1)
        const broken = d.integrity?.filter((c) => c.violations) ?? []
        return (
          <>
            <Tiles items={[
              { title: 'Originals preserved', value: d.evidenceStored, note: 'stored payloads with checksums' },
              { title: 'Dead letters', value: d.deadLetters, note: 'failed after all retries' },
              d.integrity
                ? { title: 'Integrity checks', value: broken.length === 0 ? 'All pass' : `${broken.length} failing`, note: `${d.integrity.length} checks` }
                : { title: 'Integrity checks', value: 'n/a', note: 'needs access to both commodities' },
            ]} />
            <div className="grid two">
              <section className="card">
                <header><h2>Source to decision</h2></header>
                <div className="table-wrap"><table>
                  <thead><tr><th>Step</th><th>Count</th></tr></thead>
                  <tbody>{d.funnel.map((f) => <tr key={f.step}><td>{f.step}</td><td><Bar value={f.count} max={top} /></td></tr>)}</tbody>
                </table></div>
                <p className="muted small" style={{ padding: '0 12px' }}>Counts fall because not every payload raises an alert, and not every alert needs an assessment yet.</p>
              </section>
              <section className="card">
                <header><h2>What happened to each observation</h2></header>
                <div className="table-wrap"><table>
                  <thead><tr><th>Outcome</th><th>Observations</th></tr></thead>
                  <tbody>{d.observationOutcomes.map((o) => <tr key={o.outcome}><td>{label(o.outcome)}</td><td>{o.count}</td></tr>)}</tbody>
                </table></div>
                <div className="table-wrap"><table>
                  <thead><tr><th>Ingestion runs</th><th>Records</th></tr></thead>
                  <tbody>
                    <tr><td>Accepted</td><td>{d.runTotals.accepted}</td></tr>
                    <tr><td>Duplicate (ignored)</td><td>{d.runTotals.duplicate}</td></tr>
                    <tr><td>Quarantined</td><td>{d.runTotals.quarantined}</td></tr>
                    {d.quarantine.map((q) => <tr key={q.status}><td className="muted">Quarantine item: {label(q.status)}</td><td>{q.count}</td></tr>)}
                  </tbody>
                </table></div>
              </section>
            </div>
            <section className="card">
              <header><h2>Source freshness</h2></header>
              <div className="table-wrap"><table>
                <thead><tr><th>Source</th><th>Mode</th><th>Last usable data</th><th>Policy</th><th>State</th></tr></thead>
                <tbody>{d.sources.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}</td><td><ModeBadge mode={s.mode} /></td>
                    <td>{s.hoursSinceUsable != null ? `${s.hoursSinceUsable} h ago` : 'never'}</td>
                    <td>{s.policyHours} h</td>
                    <td><span className={`badge ${STATE_BADGE[s.state][0]}`}>{STATE_BADGE[s.state][1]}</span></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </section>
            {d.integrity && (
              <section className="card">
                <header><h2>Integrity checks</h2><span className="muted small">rows that break a rule of the life cycle; zero is healthy</span></header>
                <div className="table-wrap"><table>
                  <thead><tr><th>Rule</th><th>Violations</th></tr></thead>
                  <tbody>{d.integrity.map((c) => (
                    <tr key={c.check}><td>{c.check}</td><td className={c.violations ? 'bad-text' : 'ok-text'}>{c.violations || 'Pass'}</td></tr>
                  ))}</tbody>
                </table></div>
              </section>
            )}
            <AsOf at={d.asOf} />
          </>
        )
      }}</Loaded>
    </div>
  )
}
