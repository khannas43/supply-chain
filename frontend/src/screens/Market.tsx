import { Link } from 'react-router-dom'
import { Chart, axisStyle } from '../components/Chart'
import { PageHead } from '../components/ui'
import { CONFIG, fmtDate, ratingOf } from '../prototype/data'
import {
  COUNTRY_RISK, FLOWS, HHI, PRICES, RISK_COLS, SHARES, SRC, SUPPLY, TOP3_SHARE, TOTAL_PRODUCTION, TOTAL_RESERVES, countryOverall, type Src,
} from '../prototype/market'
import { RagBadge, RepresentativeBadge } from '../prototype/parts'

function SourceNote({ s }: { s: Src }) {
  return (
    <p className="muted small" style={{ marginBottom: 0 }}>
      Source: {s.source}. As of {fmtDate(s.asOf)}, refreshed {fmtDate(s.refreshed)}. {s.licence}.
      {s.stale && <> <span className="badge b-warn" title="Part of this data is an annual baseline">Part stale</span></>}
    </p>
  )
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })

export function Market() {
  const last = PRICES[PRICES.length - 1].usdPerT
  const yearAgo = PRICES[PRICES.length - 13].usdPerT
  const change = last / yearAgo - 1
  const china = SHARES[0].share

  return (
    <div className="page">
      <PageHead title="Market overview">
        Tungsten supply, trade, price and country risk behind the purchase. Read-only; every figure shows its source and date.
      </PageHead>
      <div className="row"><RepresentativeBadge /><span className="muted small">Prototype for buyer review: invented figures shaped like the Credibl data products. Many sources are monthly or annual, so this is a purchasing view, not real-time monitoring.</span></div>

      <div className="grid tiles">
        <div className="tile"><h3>World mine supply</h3><div className="big">{TOTAL_PRODUCTION.toFixed(0)} kt</div><div className="sub">tungsten content, latest year</div></div>
        <div className="tile"><h3>Largest producer</h3><div className="big">{pct(china)}</div><div className="sub">China’s share of mine supply</div></div>
        <div className="tile"><h3>Top-three share</h3><div className="big">{pct(TOP3_SHARE)}</div><div className="sub">HHI {HHI.toLocaleString('en-GB')} (a lower bound; 10,000 = one supplier)</div></div>
        <div className="tile"><h3>APT reference price</h3><div className="big">USD {last.toLocaleString('en-GB')}/t</div><div className="sub">{change >= 0 ? '+' : ''}{(change * 100).toFixed(0)}% over 12 months, monthly series</div></div>
      </div>

      <div className="grid two">
        <section className="card">
          <header><h2>Mine production by country</h2><span className="muted small">kt tungsten content</span></header>
          <Chart height={280} label={`Mine production by country in kilotonnes: ${SUPPLY.map((s) => `${s.country} ${s.productionKt}`).join(', ')}`} build={(t) => ({
            grid: { left: 110, right: 40, top: 8, bottom: 24 }, tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: { type: 'value', axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } } },
            yAxis: { type: 'category', inverse: true, data: SUPPLY.map((s) => s.country), ...axisStyle(t) },
            series: [{ type: 'bar', data: SUPPLY.map((s) => s.productionKt), itemStyle: { color: t.series[0], borderRadius: [0, 4, 4, 0] }, barMaxWidth: 20, label: { show: true, position: 'right', color: t.muted, formatter: '{c}' } }],
          })} />
          <SourceNote s={SRC.supply} />
        </section>
        <section className="card">
          <header><h2>Reserves by country</h2><span className="muted small">kt tungsten content, {TOTAL_RESERVES.toLocaleString('en-GB')} kt in total</span></header>
          <Chart height={280} label={`Reserves by country in kilotonnes: ${SUPPLY.map((s) => `${s.country} ${s.reservesKt}`).join(', ')}`} build={(t) => ({
            grid: { left: 110, right: 50, top: 8, bottom: 24 }, tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
            xAxis: { type: 'value', axisLabel: { color: t.muted }, splitLine: { lineStyle: { color: t.grid } } },
            yAxis: { type: 'category', inverse: true, data: SUPPLY.map((s) => s.country), ...axisStyle(t) },
            series: [{ type: 'bar', data: SUPPLY.map((s) => s.reservesKt), itemStyle: { color: t.series[2], borderRadius: [0, 4, 4, 0] }, barMaxWidth: 20, label: { show: true, position: 'right', color: t.muted, formatter: '{c}' } }],
          })} />
          <SourceNote s={SRC.supply} />
        </section>
      </div>

      <section className="card">
        <header><h2>APT reference price, 24 months</h2><span className="muted small">USD per tonne, monthly. Used as the indicative price where there is no quote ({CONFIG.referencePriceUsdPerT.toLocaleString('en-GB')} USD/t).</span></header>
        <Chart height={260} label={`Monthly APT reference price from ${monthLabel(PRICES[0].month)} to ${monthLabel(PRICES[23].month)}, rising from ${PRICES[0].usdPerT} to ${last} USD per tonne`} build={(t) => ({
          grid: { left: 56, right: 16, top: 12, bottom: 28 }, tooltip: { trigger: 'axis' },
          xAxis: { type: 'category', data: PRICES.map((p) => monthLabel(p.month)), ...axisStyle(t) },
          yAxis: { type: 'value', scale: true, axisLabel: { color: t.muted, formatter: (v: number) => `${v / 1000}k` }, splitLine: { lineStyle: { color: t.grid } } },
          series: [{ type: 'line', data: PRICES.map((p) => p.usdPerT), smooth: true, showSymbol: false, lineStyle: { width: 2.5, color: t.series[0] }, areaStyle: { color: t.series[0], opacity: 0.08 } }],
        })} />
        <SourceNote s={SRC.price} />
      </section>

      <div className="grid two">
        <section className="card">
          <header><h2>Main trade flows</h2><span className="muted small">kt tungsten content, exporter to importer</span></header>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Exporter</th><th>Importer</th><th>Volume (kt)</th></tr></thead>
              <tbody>
                {FLOWS.map((f) => (
                  <tr key={`${f.from}-${f.to}`}><td>{f.from}</td><td>{f.to}</td>
                    <td><span className="bar"><i style={{ width: `${f.kt * 18}px` }} />{f.kt.toFixed(1)}</span></td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <SourceNote s={SRC.trade} />
        </section>

        <section className="card">
          <header><h2>Current risk by country</h2><span className="muted small">1 = most favourable</span></header>
          <div className="table-wrap">
            <table className="rank">
              <thead><tr><th>Country</th>{RISK_COLS.map((c) => <th key={c}>{c}</th>)}<th>Overall</th></tr></thead>
              <tbody>
                {COUNTRY_RISK.map((c) => {
                  const o = countryOverall(c.scores)
                  return (
                    <tr key={c.country}>
                      <td>{c.country}</td>
                      {c.scores.map((v, i) => {
                        const r = ratingOf(v)
                        return <td key={i} className={`heat heat-${r}`} title={`${RISK_COLS[i]}: ${r}`}><div style={{ padding: '8px 0', textAlign: 'center' }}><strong>{v.toFixed(1)}</strong></div></td>
                      })}
                      <td><RagBadge rating={o.rating} score={o.score} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="muted small">Conflict uses an annual baseline and is stale between releases. Ownership exposure is not screened. A missing score would show as unknown, never as a good one.</p>
          <SourceNote s={SRC.risk} />
        </section>
      </div>

      <div className="row"><Link to="/suppliers" className="btn primary">Go to the supplier dashboard</Link><span className="muted small">Producers, refiners and projects behind these countries, with indicative ratings.</span></div>
    </div>
  )
}
