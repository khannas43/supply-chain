import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import * as echarts from 'echarts'
import { NOW, trend } from '../data/mock'
import { sourceState } from '../data/pipeline'
import { usePipeline } from '../data/pipelineStore'
import { useStore } from '../data/store'
import { useApp } from '../components/AppContext'
import { ModeBadge, PageHead, STATE_BADGE, SeverityBadge, formatTime } from '../components/ui'
import type { Severity } from '../data/types'

const SEV: Severity[] = ['critical', 'high', 'medium', 'low']

function TrendChart({ data }: { data: { day: string; count: number }[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!ref.current) return
    const chart = echarts.init(ref.current)
    const css = getComputedStyle(document.documentElement)
    const accent = css.getPropertyValue('--accent').trim()
    const muted = css.getPropertyValue('--muted').trim()
    chart.setOption({
      grid: { left: 28, right: 12, top: 12, bottom: 24 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: data.map((d) => d.day), axisLabel: { color: muted } },
      yAxis: { type: 'value', minInterval: 1, axisLabel: { color: muted }, splitLine: { lineStyle: { opacity: 0.3 } } },
      series: [{ type: 'bar', data: data.map((d) => d.count), itemStyle: { color: accent }, barMaxWidth: 28 }],
      aria: { enabled: true },
    })
    const onResize = () => chart.resize()
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chart.dispose()
    }
  }, [data])
  return <div ref={ref} style={{ height: 200 }} role="img" aria-label="Alerts raised per day" />
}

export function Overview() {
  const { commodity } = useApp()
  const { alerts, actions: allActions } = useStore()
  const list = alerts.filter((a) => a.commodity === commodity && a.disposition !== 'dismissed')
  const withExposure = list.filter((a) => a.exposed)
  const mine = allActions.filter((a) => a.commodity === commodity)
  const actions = {
    open: mine.filter((a) => a.status === 'open').length,
    inProgress: mine.filter((a) => a.status === 'in_progress').length,
    review: mine.filter((a) => a.status === 'review').length,
  }
  const { sources } = usePipeline()
  const freshness = sources.filter((s) => s.commodities.includes(commodity))
  const name = commodity[0].toUpperCase() + commodity.slice(1)

  return (
    <div className="page">
      <PageHead title={`${name} overview`}>
        What is exposed, what is at risk and what is being done. Figures come from the latest published assessments.
      </PageHead>

      <div className="grid tiles">
        <Link to="/risk" className="tile">
          <h3>Active alerts</h3>
          <div className="big">{list.length}</div>
          <div className="row">
            {SEV.map((s) => {
              const n = list.filter((a) => a.severity === s).length
              return n ? <span key={s} className="row small"><SeverityBadge value={s} />{n}</span> : null
            })}
          </div>
        </Link>
        <Link to="/impact" className="tile">
          <h3>Assessed exposure</h3>
          <div className="big">{withExposure.length}</div>
          <div className="sub">alerts with a calculated exposure. Volumes are listed separately below, never summed.</div>
        </Link>
        <Link to="/actions" className="tile">
          <h3>Actions</h3>
          <div className="big">{actions.open + actions.inProgress + actions.review}</div>
          <div className="sub">{actions.open} open, {actions.inProgress} in progress, {actions.review} in review</div>
        </Link>
        <div className="tile">
          <h3>Last assessment</h3>
          <div className="big" style={{ fontSize: 18 }}>{formatTime(NOW)}</div>
          <div className="sub">Assessment status per alert is shown in the risk inbox.</div>
        </div>
      </div>

      <div className="grid two">
        <section className="card">
          <header><h2>Exposure by alert</h2><span className="muted small">units and horizon as calculated</span></header>
          {withExposure.length === 0 ? (
            <div className="empty">No alert has a supported exposure yet. A missing dependency is not evidence of zero exposure.</div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Alert</th><th>Exposed</th><th>Cover</th><th>Mode</th></tr></thead>
                <tbody>
                  {withExposure.map((a) => (
                    <tr key={a.id}>
                      <td><Link to={`/risk?alert=${a.id}`}>{a.title}</Link></td>
                      <td>{a.exposed!.value} {a.exposed!.unit} <span className="muted small">/ {a.exposed!.horizon}</span></td>
                      <td>{a.daysOfCover != null ? `${a.daysOfCover} days` : <span className="muted">unavailable</span>}</td>
                      <td><ModeBadge mode={a.mode} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="muted small" style={{ marginBottom: 0 }}>
            At-risk volume needs an approved disruption assumption and is shown on the impact screen.
          </p>
        </section>

        <section className="card">
          <header><h2>Alerts raised, last 7 days</h2></header>
          <TrendChart data={trend[commodity]} />
        </section>
      </div>

      <section className="card">
        <header><h2>Source freshness</h2><Link to="/sources" className="small">Source health</Link></header>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Source</th><th>Mode</th><th>Last usable data</th><th>Policy</th><th>State</th></tr></thead>
            <tbody>
              {freshness.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td><ModeBadge mode={s.mode} /></td>
                  <td>{formatTime(s.lastUsable)}</td>
                  <td>{s.policyHours} h</td>
                  <td><span className={`badge ${STATE_BADGE[sourceState(s)][0]}`}>{STATE_BADGE[sourceState(s)][1]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
