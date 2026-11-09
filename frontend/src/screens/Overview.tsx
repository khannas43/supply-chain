import { Link } from 'react-router-dom'
import { useApi } from '../api/hooks'
import type { OverviewData } from '../api/types'
import { useApp } from '../components/AppContext'
import { Chart, axisStyle } from '../components/Chart'
import { ModeBadge, PageHead, STATE_BADGE, SeverityBadge, formatTime } from '../components/ui'
import type { Alert, Severity } from '../data/types'

const SEV: Severity[] = ['critical', 'high', 'medium', 'low']

const cap = (x: string) => x[0].toUpperCase() + x.slice(1)
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' })

function Body({ o, alerts }: { o: OverviewData; alerts: Alert[] }) {
  const withExposure = alerts.filter((a) => a.exposed && a.disposition !== 'dismissed')
  const { actions } = o
  const sameUnit = withExposure.length > 0 && new Set(withExposure.map((a) => a.exposed!.unit)).size === 1
  const withCover = alerts.filter((a) => a.daysOfCover != null && a.disposition !== 'dismissed')

  return (
    <>
      <div className="grid tiles">
        <Link to="/risk" className="tile">
          <h3>Active alerts</h3>
          <div className="big">{o.activeAlerts}</div>
          <div className="row">
            {SEV.map((s) =>
              o.alertsBySeverity[s] ? (
                <span key={s} className="row small"><SeverityBadge value={s} />{o.alertsBySeverity[s]}</span>
              ) : null,
            )}
          </div>
        </Link>
        <Link to="/impact" className="tile">
          <h3>Assessed exposure</h3>
          <div className="big">{o.assessedAlerts}</div>
          <div className="sub">alerts with a calculated exposure. Volumes are listed separately below, never summed.</div>
        </Link>
        <Link to="/actions" className="tile">
          <h3>Actions</h3>
          <div className="big">{actions.open + actions.inProgress + actions.review}</div>
          <div className="sub">{actions.open} open, {actions.inProgress} in progress, {actions.review} in review</div>
        </Link>
        <div className="tile">
          <h3>Last assessment</h3>
          <div className="big" style={{ fontSize: 18 }}>{o.lastAssessmentAt ? formatTime(o.lastAssessmentAt) : 'None yet'}</div>
          <div className="sub">Assessment status per alert is shown in the risk inbox.</div>
        </div>
      </div>

      <div className="grid two">
        <section className="card">
          <header><h2>Alerts by severity</h2><span className="muted small">{o.activeAlerts} active</span></header>
          <Chart height={230} label={`Alerts by severity: ${SEV.map((x) => `${o.alertsBySeverity[x] ?? 0} ${x}`).join(', ')}`} build={(t) => ({
            tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
            legend: { bottom: 0, textStyle: { color: t.muted }, itemWidth: 10, itemHeight: 10 },
            series: [{ type: 'pie', radius: ['52%', '76%'], center: ['50%', '44%'], itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 },
              label: { show: true, position: 'center', formatter: `${o.activeAlerts}\nactive`, color: t.text, fontSize: 16, lineHeight: 20 },
              data: SEV.filter((x) => o.alertsBySeverity[x]).map((x) => ({ name: cap(x), value: o.alertsBySeverity[x], itemStyle: { color: t.sev[x] } })) }],
          })} />
        </section>
        <section className="card">
          <header><h2>Alerts raised, last 7 days</h2></header>
          <Chart height={230} label={`Alerts raised per day: ${o.trend.map((d) => `${dayLabel(d.day)} ${d.count}`).join(', ')}`} build={(t) => ({
            grid: { left: 28, right: 12, top: 16, bottom: 24 },
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: o.trend.map((d) => dayLabel(d.day)), ...axisStyle(t) },
            yAxis: { type: 'value', minInterval: 1, axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } } },
            series: [{ type: 'bar', data: o.trend.map((d) => d.count), itemStyle: { color: t.series[0], borderRadius: [4, 4, 0, 0] }, barMaxWidth: 28 }],
          })} />
        </section>
      </div>

      <div className="grid two">
        <section className="card">
          <header><h2>Exposure by alert</h2><span className="muted small">{sameUnit ? `volume exposed, ${withExposure[0].exposed!.unit}` : 'units differ, so values are listed, not charted'}</span></header>
          {withExposure.length === 0 ? (
            <div className="empty">No alert has a supported exposure yet. A missing dependency is not evidence of zero exposure.</div>
          ) : sameUnit ? (
            <Chart height={Math.max(160, 40 * withExposure.length + 20)} label={`Exposure by alert: ${withExposure.map((a) => `${a.title} ${a.exposed!.value} ${a.exposed!.unit}`).join('; ')}`} build={(t) => {
              const rows = [...withExposure].sort((x, y) => x.exposed!.value - y.exposed!.value)
              return {
                grid: { left: 210, right: 60, top: 8, bottom: 8 },
                tooltip: { trigger: 'axis', axisPointer: { type: 'none' }, formatter: (ps: unknown) => {
                  const a = rows[(ps as { dataIndex: number }[])[0].dataIndex]
                  return `<strong>${a.title}</strong><br/>${a.exposed!.value} ${a.exposed!.unit} over ${a.exposed!.horizon}<br/>${a.daysOfCover != null ? `${Math.round(a.daysOfCover * 10) / 10} days of cover` : 'cover unavailable'}`
                } },
                xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
                yAxis: { type: 'category', data: rows.map((a) => a.title), ...axisStyle(t), axisLabel: { color: t.muted, width: 190, overflow: 'truncate' } },
                series: [{ type: 'bar', barMaxWidth: 18, data: rows.map((a) => ({ value: a.exposed!.value, itemStyle: { color: t.sev[a.severity], borderRadius: [0, 4, 4, 0] } })),
                  label: { show: true, position: 'right', color: t.muted, formatter: (p: { value?: unknown }) => Number(p.value).toLocaleString('en-GB') } }],
              }
            }} />
          ) : (
            <div className="table-wrap"><table>
              <thead><tr><th>Alert</th><th>Exposed</th></tr></thead>
              <tbody>{withExposure.map((a) => <tr key={a.id}><td>{a.title}</td><td>{a.exposed!.value} {a.exposed!.unit}</td></tr>)}</tbody>
            </table></div>
          )}
          <p className="muted small" style={{ marginBottom: 0 }}>Bar colour is the alert's severity. Volumes are never added together. At-risk volume needs an approved disruption assumption and is shown on the impact screen.</p>
        </section>

        <section className="card">
          <header><h2>Days of cover</h2><span className="muted small">stock held against demand, per assessed alert</span></header>
          {withCover.length === 0 ? (
            <div className="empty">No cover figure is available yet.</div>
          ) : (
            <Chart height={Math.max(160, 40 * withCover.length + 20)} label={`Days of cover: ${withCover.map((a) => `${a.title} ${Math.round(a.daysOfCover!)} days`).join('; ')}`} build={(t) => {
              const rows = [...withCover].sort((x, y) => y.daysOfCover! - x.daysOfCover!)
              return {
                grid: { left: 210, right: 60, top: 8, bottom: 8 },
                tooltip: { trigger: 'axis', axisPointer: { type: 'none' } },
                xAxis: { type: 'value', axisLabel: { show: false }, splitLine: { show: false } },
                yAxis: { type: 'category', data: rows.map((a) => a.title), ...axisStyle(t), axisLabel: { color: t.muted, width: 190, overflow: 'truncate' } },
                series: [{ type: 'bar', barMaxWidth: 18, data: rows.map((a) => Math.round(a.daysOfCover! * 10) / 10), itemStyle: { color: t.series[2], borderRadius: [0, 4, 4, 0] },
                  label: { show: true, position: 'right', color: t.muted, formatter: '{c} d' } }],
              }
            }} />
          )}
        </section>
      </div>

      <section className="card">
        <header><h2>Exposure detail</h2><span className="muted small">units and horizon as calculated</span></header>
        {withExposure.length === 0 ? <div className="empty">Nothing to list yet.</div> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Alert</th><th>Exposed</th><th>Cover</th><th>Mode</th></tr></thead>
              <tbody>
                {withExposure.map((a) => (
                  <tr key={a.id}>
                    <td><Link to={`/risk?alert=${a.id}`}>{a.title}</Link></td>
                    <td>{a.exposed!.value} {a.exposed!.unit} <span className="muted small">/ {a.exposed!.horizon}</span></td>
                    <td>{a.daysOfCover != null ? `${Math.round(a.daysOfCover * 10) / 10} days` : <span className="muted">unavailable</span>}</td>
                    <td><ModeBadge mode={a.mode} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid two">
        <section className="card">
          <header><h2>Action progress</h2><Link to="/actions" className="small">Action register</Link></header>
          <Chart height={220} label={`Actions: ${actions.open} open, ${actions.inProgress} in progress, ${actions.review} in review, ${actions.done} done`} build={(t) => ({
            tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
            legend: { bottom: 0, textStyle: { color: t.muted }, itemWidth: 10, itemHeight: 10 },
            series: [{ type: 'pie', radius: ['52%', '76%'], center: ['50%', '44%'], itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 4 },
              label: { show: true, position: 'center', formatter: `${actions.done}/${actions.open + actions.inProgress + actions.review + actions.done}\ndone`, color: t.text, fontSize: 16, lineHeight: 20 },
              data: [['Open', actions.open, t.sev.low], ['In progress', actions.inProgress, t.series[0]], ['Review', actions.review, t.warn], ['Done', actions.done, t.ok]]
                .map(([n, v, c]) => ({ name: n as string, value: v as number, itemStyle: { color: c as string } })) }],
          })} />
        </section>
        <section className="card">
          <header><h2>Source freshness</h2><Link to="/sources" className="small">Source health</Link></header>
          <Chart height={220} label={`Source freshness: ${o.sources.map((x) => `${x.name} ${x.hoursSinceUsable != null ? Math.round(x.hoursSinceUsable) : 'never'} h of ${x.policyHours} h`).join('; ')}`} build={(t) => {
            const rows = [...o.sources].reverse()
            return {
              grid: { left: 160, right: 24, top: 24, bottom: 24 },
              tooltip: { trigger: 'axis', axisPointer: { type: 'none' } },
              xAxis: { type: 'value', name: '% of allowed age', nameLocation: 'middle', nameGap: 22, nameTextStyle: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } }, axisLabel: { color: t.muted } },
              yAxis: { type: 'category', data: rows.map((x) => x.name), ...axisStyle(t) },
              series: [{ type: 'bar', barMaxWidth: 16,
                data: rows.map((x) => ({ value: x.hoursSinceUsable == null ? 0 : Math.round((100 * x.hoursSinceUsable) / x.policyHours),
                  itemStyle: { color: x.hoursSinceUsable == null || x.hoursSinceUsable > x.policyHours ? t.warn : t.series[0], borderRadius: [0, 4, 4, 0] } })),
                markLine: { silent: true, symbol: 'none', lineStyle: { color: t.bad, type: 'dashed' }, label: { color: t.muted, formatter: 'allowed age', position: 'end' }, data: [{ xAxis: 100 }] } }],
            }
          }} />
        </section>
      </div>

      <section className="card">
        <header><h2>Source detail</h2></header>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Source</th><th>Mode</th><th>Last usable data</th><th>Policy</th><th>State</th></tr></thead>
            <tbody>
              {o.sources.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}{s.lastError && <div className="small" style={{ color: 'var(--bad)' }}>{s.lastError}</div>}</td>
                  <td><ModeBadge mode={s.mode} /></td>
                  <td>{s.lastUsable ? formatTime(s.lastUsable) : 'never'}{s.hoursSinceUsable != null && <div className="muted small">{Math.round(s.hoursSinceUsable)} h ago</div>}</td>
                  <td>{s.policyHours} h</td>
                  <td><span className={`badge ${STATE_BADGE[s.state][0]}`}>{STATE_BADGE[s.state][1]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

export function Overview() {
  const { commodity } = useApp()
  const overview = useApi<OverviewData>(`/overview?commodity=${commodity}`)
  const alerts = useApi<Alert[]>(`/alerts?commodity=${commodity}`)
  const name = commodity[0].toUpperCase() + commodity.slice(1)
  // wait for the data of the selected commodity, not the previous one
  const ready = overview.data?.commodity === commodity && alerts.data !== null
  const error = overview.error ?? alerts.error
  const reload = () => { overview.reload(); alerts.reload() }

  return (
    <div className="page">
      <PageHead title={`${name} overview`}>
        What is exposed, what is at risk and what is being done. Figures come from the latest published assessments.
      </PageHead>
      {error && (
        <div className="notice" role="alert">
          {error} <button className="btn" onClick={reload}>Retry</button>
        </div>
      )}
      {ready ? <Body o={overview.data!} alerts={alerts.data!} /> : !error && <div className="empty" role="status">Loading…</div>}
    </div>
  )
}
