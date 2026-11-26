import * as echarts from 'echarts'
import { feature } from 'topojson-client'
import type { FeatureCollection } from 'geojson'
import type { Topology } from 'topojson-specification'
import world from 'world-atlas/countries-110m.json'
import { Chart, type Theme } from '../components/Chart'
import { RATING_LABEL, hasCoords, headline, isEmerging, siteOf, type Rating, type Supplier } from './data'

let registered = false
function ensureMap() {
  if (registered) return
  const topo = world as unknown as Topology
  const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection
  fc.features = fc.features.filter((f) => (f.properties as { name?: string } | null)?.name !== 'Antarctica')
  echarts.registerMap('world', fc as never)
  registered = true
}

const SHAPE = { Mine: 'triangle', Refinery: 'rect', Project: 'diamond' } as const
const colour = (t: Theme, r: Rating) => (r === 'green' ? t.ok : r === 'amber' ? t.warn : r === 'red' ? t.bad : t.muted)

// Mines, refineries and projects coloured by headline rating; emerging suppliers have a ring.
export function SupplierMap({ suppliers, onOpen }: { suppliers: Supplier[]; onOpen: (id: string) => void }) {
  ensureMap()
  const pts = suppliers.filter(hasCoords).map((s) => ({ s, r: headline(s), site: siteOf(s) }))
  const label = `Map of ${pts.length} suppliers: ${pts.map((p) => `${p.s.name} in ${p.s.country}, ${p.s.assetType.toLowerCase()}, headline ${RATING_LABEL[p.r]}`).join('; ')}`
  return (
    <Chart
      height={460}
      label={label}
      onClick={(p) => { const d = p.data as { id?: string } | undefined; if (d?.id) onOpen(d.id) }}
      build={(t) => ({
        tooltip: {
          trigger: 'item',
          formatter: (p: unknown) => {
            const d = (p as { data?: { name: string; id: string } }).data
            const s = suppliers.find((x) => x.id === d?.id)
            if (!s) return ''
            return `<strong>${s.name}</strong><br/>${s.country} · ${s.assetType}, ${s.stage.toLowerCase()}${isEmerging(s) ? ' · emerging' : ''}<br/>Headline: ${RATING_LABEL[headline(s)]}<br/><em>${siteOf(s).site}. Click to open the profile.</em>`
          },
        },
        geo: { map: 'world', roam: true, zoom: 1.1, silent: true, itemStyle: { areaColor: t.grid, borderColor: t.surface, borderWidth: 0.6 }, emphasis: { disabled: true } },
        series: [
          { name: 'Emerging', type: 'scatter', coordinateSystem: 'geo', silent: true, z: 2, symbol: 'circle', symbolSize: 26, itemStyle: { color: 'transparent', borderColor: t.accent, borderWidth: 2, borderType: 'dashed' },
            data: pts.filter((p) => isEmerging(p.s)).map((p) => ({ name: p.s.name, id: p.s.id, value: [p.site.lon, p.site.lat] })) },
          { name: 'Suppliers', type: 'scatter', coordinateSystem: 'geo', z: 3, symbolSize: 15, itemStyle: { borderColor: t.surface, borderWidth: 1.5 },
            data: pts.map((p) => ({ name: p.s.name, id: p.s.id, value: [p.site.lon, p.site.lat], symbol: SHAPE[p.s.assetType], itemStyle: { color: colour(t, p.r), borderColor: t.surface, borderWidth: 1.5 } })) },
        ],
      })}
    />
  )
}

export function MapLegend() {
  const dot = (colour: string, text: string) => <span><span className="dot" style={{ background: `var(${colour})`, borderRadius: 3 }} />{text}</span>
  return (
    <div className="legend" aria-label="Map legend">
      {dot('--ok', 'Green')}{dot('--warn', 'Amber')}{dot('--bad', 'Red')}{dot('--muted', 'Unknown')}
      <span>▲ Mine · ■ Refinery · ◆ Project</span>
      <span>Dashed ring = emerging supplier</span>
      <span className="muted">Colour is the headline rating (worst of the three risk dimensions). Scroll to zoom, drag to move.</span>
    </div>
  )
}
