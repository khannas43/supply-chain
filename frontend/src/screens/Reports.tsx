import { Link } from 'react-router-dom'
import { useApi } from '../api/hooks'
import { useApp } from '../components/AppContext'
import { Chart, axisStyle } from '../components/Chart'
import { Loaded } from '../components/Remote'
import { ModeBadge, PageHead, STATE_BADGE, SeverityBadge, formatTime } from '../components/ui'
import type { Confidence, Mode, Severity } from '../data/types'

const SEV: Severity[] = ['critical', 'high', 'medium', 'low']
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const label = (s: string) => cap(s.replace(/_/g, ' '))

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
              <header><h2>Alerts by severity</h2><span className="muted small">per commodity</span></header>
              <Chart height={230} label={`Alerts by severity: ${d.bySeverity.map((r) => `${r.commodity} ${SEV.map((s) => `${r[s]} ${s}`).join(', ')}`).join('; ')}`} build={(t) => ({
                grid: { left: 70, right: 16, top: 36, bottom: 8 },
                legend: { top: 0, textStyle: { color: t.muted }, itemWidth: 10, itemHeight: 10 },
                tooltip: { trigger: 'axis', axisPointer: { type: 'none' } },
                xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
                yAxis: { type: 'category', data: d.bySeverity.map((r) => cap(r.commodity)), ...axisStyle(t) },
                series: SEV.map((sv) => ({
                  name: cap(sv), type: 'bar', stack: 'sev', barMaxWidth: 34, data: d.bySeverity.map((r) => r[sv]),
                  itemStyle: { color: t.sev[sv], borderColor: t.surface, borderWidth: 2, borderRadius: 3 },
                  label: { show: true, color: '#fff', formatter: (p: { value?: unknown }) => (p.value ? String(p.value) : '') },
                })),
              })} />
            </section>
            <section className="card">
              <header><h2>Assessment progress</h2><span className="muted small">{d.totals.activeAlerts} active alerts</span></header>
              <Chart height={230} label={`Assessment progress: ${d.byAssessmentStatus.map((s) => `${s.count} ${label(s.status)}`).join(', ')}`} build={(t) => ({
                tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                legend: { bottom: 0, textStyle: { color: t.muted }, itemWidth: 10, itemHeight: 10 },
                series: [{
                  type: 'pie', radius: ['52%', '76%'], center: ['50%', '44%'], avoidLabelOverlap: true,
                  itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 },
                  label: { show: true, position: 'center', formatter: `${d.totals.assessed}/${d.totals.activeAlerts}\nassessed`, color: t.text, fontSize: 16, lineHeight: 20 },
                  emphasis: { label: { show: true } },
                  data: d.byAssessmentStatus.map((x) => ({
                    name: label(x.status), value: x.count,
                    itemStyle: { color: ({ complete: t.ok, awaiting_validation: t.series[0], partial: t.warn, unassessed: t.sev.low } as Record<string, string>)[x.status] },
                  })),
                }],
              })} />
            </section>
          </div>
          <section className="card">
            <header><h2>Where the alerts are</h2><span className="muted small">alerts per place; hover for the nodes each one matches</span></header>
            <Chart height={Math.max(180, 30 * Math.min(d.byLocation.length, 10) + 40)} label={`Alerts by location: ${d.byLocation.slice(0, 10).map((l) => `${cap(l.commodity)} ${l.location} ${l.alerts}`).join(', ')}`} build={(t) => {
              const rows = d.byLocation.slice(0, 10).reverse()
              return {
                grid: { left: 190, right: 24, top: 8, bottom: 8 },
                tooltip: { trigger: 'axis', axisPointer: { type: 'none' }, formatter: (ps: unknown) => {
                  const l = rows[(ps as { dataIndex: number }[])[0].dataIndex]
                  return `<strong>${cap(l.commodity)} · ${l.location}</strong><br/>${l.alerts} alert${l.alerts === 1 ? '' : 's'}<br/>${l.exposedNodes} nodes matched`
                } },
                xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
                yAxis: { type: 'category', data: rows.map((l) => `${cap(l.commodity)} · ${l.location}`), ...axisStyle(t) },
                series: [{ type: 'bar', barMaxWidth: 16, data: rows.map((l) => ({ value: l.alerts, itemStyle: { color: l.commodity === 'wheat' ? t.series[0] : t.series[3], borderRadius: [0, 4, 4, 0] } })),
                  label: { show: true, position: 'right', color: t.muted } }],
              }
            }} />
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
              <header><h2>Nodes by country</h2><span className="muted small">top 12, share of all nodes; amber is 25% or more</span></header>
              <Chart height={Math.max(220, 26 * d.byCountry.length + 40)} label={`Nodes by country: ${d.byCountry.map((c) => `${c.country} ${c.share}%`).join(', ')}`} build={(t) => {
                const rows = [...d.byCountry].reverse()
                return {
                  grid: { left: 100, right: 48, top: 8, bottom: 8 },
                  tooltip: { trigger: 'axis', axisPointer: { type: 'none' }, formatter: (ps: unknown) => {
                    const p = (ps as { dataIndex: number }[])[0]; const c = rows[p.dataIndex]
                    return `<strong>${c.country}</strong><br/>${c.nodes} nodes (${c.share}%)<br/>${Object.entries(c.kinds).map(([k, n]) => `${n} ${k}`).join(', ')}`
                  } },
                  xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
                  yAxis: { type: 'category', data: rows.map((c) => c.country), ...axisStyle(t) },
                  series: [{ type: 'bar', barMaxWidth: 14, data: rows.map((c) => ({ value: c.nodes, itemStyle: { color: c.share >= 25 ? t.warn : t.series[0], borderRadius: [0, 4, 4, 0] } })),
                    label: { show: true, position: 'right', color: t.muted, formatter: (p: { dataIndex: number }) => `${rows[p.dataIndex].share}%` } }],
                }
              }} />
            </section>
            <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
              <section className="card">
                <header><h2>Network make-up</h2></header>
                <Chart height={200} label={`Nodes by kind: ${d.byKind.map((k) => `${k.count} ${k.kind}`).join(', ')}`} build={(t) => ({
                  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                  legend: { right: 0, orient: 'vertical', top: 'middle', textStyle: { color: t.muted }, itemWidth: 10, itemHeight: 10 },
                  series: [{ type: 'pie', radius: ['50%', '75%'], center: ['35%', '50%'], itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 }, label: { show: false },
                    data: d.byKind.map((k, i) => ({ name: label(k.kind), value: k.count, itemStyle: { color: t.series[i % t.series.length] } })) }],
                })} />
              </section>
              <section className="card">
                <header><h2>Link confidence</h2><span className="muted small">how well each supplier link is evidenced</span></header>
                <Chart height={130} label={`Link confidence: ${d.linkConfidence.map((k) => `${k.count} ${k.confidence}`).join(', ')}`} build={(t) => {
                  const order = ['high', 'medium', 'low']
                  const col: Record<string, string> = { high: t.ok, medium: t.warn, low: t.bad }
                  return {
                    grid: { left: 8, right: 8, top: 24, bottom: 4 },
                    legend: { top: 0, textStyle: { color: t.muted }, itemWidth: 10, itemHeight: 10 },
                    tooltip: { trigger: 'item' },
                    xAxis: { type: 'value', show: false, max: d.totals.links }, yAxis: { type: 'category', show: false, data: ['links'] },
                    series: order.map((o) => ({ name: cap(o), type: 'bar', stack: 'c', barWidth: 28, data: [d.linkConfidence.find((k) => k.confidence === o)?.count ?? 0],
                      itemStyle: { color: col[o], borderColor: t.surface, borderWidth: 2, borderRadius: 3 }, label: { show: true, color: '#fff' } })),
                  }
                }} />
              </section>
            </div>
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
              <header><h2>Where actions stand</h2><span className="muted small">{d.totals.actions} actions</span></header>
              <Chart height={240} label={`Actions by status: ${d.byStatus.map((s) => `${s.count} ${label(s.status)}`).join(', ')}`} build={(t) => ({
                tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                legend: { bottom: 0, textStyle: { color: t.muted }, itemWidth: 10, itemHeight: 10 },
                series: [{ type: 'pie', radius: ['52%', '76%'], center: ['50%', '44%'], itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 },
                  label: { show: true, position: 'center', formatter: `${d.totals.done}/${d.totals.actions}\ndone`, color: t.text, fontSize: 16, lineHeight: 20 },
                  data: d.byStatus.map((x) => ({ name: label(x.status), value: x.count,
                    itemStyle: { color: ({ open: t.sev.low, in_progress: t.series[0], review: t.warn, done: t.ok } as Record<string, string>)[x.status] } })) }],
              })} />
            </section>
            <section className="card">
              <header><h2>Workload by owner</h2><span className="muted small">overdue, on track and done</span></header>
              <Chart height={240} label={`Actions by owner: ${d.byOwner.map((o) => `${o.owner} ${o.open} open, ${o.overdue} overdue`).join('; ')}`} build={(t) => {
                const rows = [...d.byOwner].reverse()
                return {
                  grid: { left: 130, right: 16, top: 30, bottom: 8 },
                  legend: { top: 0, textStyle: { color: t.muted }, itemWidth: 10, itemHeight: 10 },
                  tooltip: { trigger: 'axis', axisPointer: { type: 'none' } },
                  xAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
                  yAxis: { type: 'category', data: rows.map((o) => o.owner), ...axisStyle(t) },
                  series: [
                    { name: 'Overdue', color: t.bad, data: rows.map((o) => o.overdue) },
                    { name: 'On track', color: t.series[0], data: rows.map((o) => o.open - o.overdue) },
                    { name: 'Done', color: t.ok, data: rows.map((o) => o.total - o.open) },
                  ].map((x) => ({ name: x.name, type: 'bar' as const, stack: 'o', barMaxWidth: 20, data: x.data,
                    itemStyle: { color: x.color, borderColor: t.surface, borderWidth: 2, borderRadius: 3 } })),
                }
              }} />
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
                <header><h2>Source to decision</h2><span className="muted small">counts fall: not every payload raises an alert</span></header>
                <Chart height={260} label={`Source to decision: ${d.funnel.map((f) => `${f.step} ${f.count}`).join(', ')}`} build={(t) => {
                  const rows = [...d.funnel].reverse()
                  return {
                    grid: { left: 150, right: 40, top: 8, bottom: 8 },
                    tooltip: { trigger: 'axis', axisPointer: { type: 'none' } },
                    xAxis: { type: 'value', max: top, axisLabel: { show: false }, splitLine: { show: false } },
                    yAxis: { type: 'category', data: rows.map((f) => f.step), ...axisStyle(t) },
                    series: [{ type: 'bar', barMaxWidth: 22, data: rows.map((f) => f.count), itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] },
                      label: { show: true, position: 'right', color: t.muted } }],
                  }
                }} />
              </section>
              <section className="card">
                <header><h2>What happened to each observation</h2></header>
                <Chart height={190} label={`Observation outcomes: ${d.observationOutcomes.map((o) => `${o.count} ${label(o.outcome)}`).join(', ')}`} build={(t) => ({
                  tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
                  legend: { right: 0, orient: 'vertical', top: 'middle', textStyle: { color: t.muted }, itemWidth: 10, itemHeight: 10 },
                  series: [{ type: 'pie', radius: ['48%', '74%'], center: ['32%', '50%'], itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 }, label: { show: false },
                    data: d.observationOutcomes.map((o, i) => ({ name: label(o.outcome), value: o.count, itemStyle: { color: t.series[i % t.series.length] } })) }],
                })} />
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
              <header><h2>Source freshness</h2><span className="muted small">hours since usable data against each source's allowed age</span></header>
              <Chart height={Math.max(150, 46 * d.sources.length + 30)} label={`Source freshness: ${d.sources.map((x) => `${x.name} ${x.hoursSinceUsable ?? 'never'} h of ${x.policyHours} h`).join('; ')}`} build={(t) => {
                const rows = [...d.sources].reverse()
                return {
                  grid: { left: 170, right: 24, top: 24, bottom: 24 },
                  tooltip: { trigger: 'axis', axisPointer: { type: 'none' } },
                  xAxis: { type: 'value', name: '% of allowed age', nameLocation: 'middle', nameGap: 22, nameTextStyle: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
                  yAxis: { type: 'category', data: rows.map((x) => x.name), ...axisStyle(t) },
                  series: [{ type: 'bar', barMaxWidth: 16,
                    data: rows.map((x) => ({ value: x.hoursSinceUsable == null ? 0 : Math.round((100 * x.hoursSinceUsable) / x.policyHours),
                      itemStyle: { color: x.hoursSinceUsable == null || x.hoursSinceUsable > x.policyHours ? t.warn : t.series[0], borderRadius: [0, 4, 4, 0] } })),
                    markLine: { silent: true, symbol: 'none', lineStyle: { color: t.bad, type: 'dashed' }, label: { color: t.muted, formatter: 'allowed age', position: 'end' }, data: [{ xAxis: 100 }] } }],
                }
              }} />
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
