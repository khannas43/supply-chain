// Representative market data for the Market Overview (S11). Shaped like Credibl C-01 to C-04 and C-07
// country scores; the figures are invented for the prototype and are not USGS or Comtrade values.
import { CONFIG, type Rating, ratingOf } from './data'

export interface Src { source: string; asOf: string; refreshed: string; licence: string; stale?: boolean }

export const SRC: Record<'supply' | 'trade' | 'price' | 'risk', Src> = {
  supply: { source: 'USGS Mineral Commodity Summaries and BGS World Mineral Production', asOf: '2026-10-27', refreshed: '2026-11-25', licence: 'Attribution required. Source: U.S. Geological Survey; British Geological Survey' },
  trade: { source: 'UN Comtrade (HS 2611, 2841.80, 8101)', asOf: '2026-09-30', refreshed: '2026-11-18', licence: 'Shown aggregated; bulk redistribution is restricted. Source: UN Comtrade' },
  price: { source: 'Monthly APT reference price (Credibl Tier 1 reference, shown as Credibl-derived values)', asOf: CONFIG.referencePriceAsOf, refreshed: '2026-11-25', licence: 'Credibl-derived; raw Tier 1 feed is not shown' },
  risk: { source: 'Credibl country indicators (USGS, MOFCOM/GACC, UCDP, WTO/USITC, IMF PortWatch)', asOf: '2026-11-20', refreshed: '2026-11-25', licence: 'Credibl-derived scores; UCDP attribution required', stale: true },
}

export const SUPPLY: { country: string; productionKt: number; reservesKt: number }[] = [
  { country: 'China', productionKt: 68.0, reservesKt: 2400 },
  { country: 'Vietnam', productionKt: 4.0, reservesKt: 100 },
  { country: 'Russia', productionKt: 2.0, reservesKt: 400 },
  { country: 'Bolivia', productionKt: 1.4, reservesKt: 53 },
  { country: 'Rwanda', productionKt: 1.3, reservesKt: 98 },
  { country: 'Austria', productionKt: 0.9, reservesKt: 10 },
  { country: 'Portugal', productionKt: 0.7, reservesKt: 3 },
  { country: 'Other countries', productionKt: 4.7, reservesKt: 1236 },
]
export const TOTAL_PRODUCTION = SUPPLY.reduce((a, s) => a + s.productionKt, 0)
export const TOTAL_RESERVES = SUPPLY.reduce((a, s) => a + s.reservesKt, 0)
const named = SUPPLY.filter((s) => s.country !== 'Other countries')
export const SHARES = SUPPLY.map((s) => ({ ...s, share: s.productionKt / TOTAL_PRODUCTION }))
export const TOP3_SHARE = [...named].sort((a, b) => b.productionKt - a.productionKt).slice(0, 3).reduce((a, s) => a + s.productionKt, 0) / TOTAL_PRODUCTION
// lower bound: "other countries" is treated as many small producers and adds nothing
export const HHI = Math.round(named.reduce((a, s) => a + (s.productionKt / TOTAL_PRODUCTION) ** 2, 0) * 10000)

export const FLOWS: { from: string; to: string; kt: number }[] = [
  { from: 'China', to: 'Japan', kt: 6.1 }, { from: 'China', to: 'United States', kt: 4.8 }, { from: 'China', to: 'South Korea', kt: 3.9 },
  { from: 'China', to: 'Germany', kt: 3.2 }, { from: 'Vietnam', to: 'South Korea', kt: 1.8 }, { from: 'Vietnam', to: 'Japan', kt: 1.2 },
  { from: 'Russia', to: 'China', kt: 0.8 }, { from: 'Rwanda', to: 'Belgium', kt: 0.7 }, { from: 'Bolivia', to: 'United States', kt: 0.6 },
]

// 24 monthly APT reference prices, USD per tonne, ending at the reference price used for indicative cost
export const PRICES: { month: string; usdPerT: number }[] = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(Date.UTC(2024, 11 + i, 1))
  const month = d.toISOString().slice(0, 7)
  const v = i === 23 ? CONFIG.referencePriceUsdPerT : Math.round((28000 + 13000 * (i / 23) ** 1.4 + 600 * Math.sin(i * 1.3)) / 50) * 50
  return { month, usdPerT: v }
})

export const RISK_COLS = ['Supply share', 'Export', 'Conflict', 'Tariff', 'Route'] as const
export const COUNTRY_RISK: { country: string; scores: number[] }[] = [
  { country: 'China', scores: [5.0, 4.6, 1.8, 3.8, 3.6] },
  { country: 'Russia', scores: [3.8, 3.2, 3.8, 3.5, 3.9] },
  { country: 'Rwanda', scores: [2.5, 2.2, 4.3, 2.4, 3.4] },
  { country: 'Vietnam', scores: [2.4, 2.0, 2.0, 3.0, 3.2] },
  { country: 'Bolivia', scores: [2.4, 2.0, 2.6, 2.2, 3.3] },
  { country: 'Austria', scores: [2.0, 1.5, 1.2, 1.5, 1.8] },
  { country: 'Portugal', scores: [1.8, 1.4, 1.3, 1.4, 1.9] },
]
export const countryOverall = (scores: number[]): { score: number; rating: Rating } => {
  const score = scores.reduce((a, b) => a + b, 0) / scores.length
  return { score, rating: ratingOf(score) }
}

// Alternative origins and spare capacity for the stress test (representative; Credibl scenario template output)
export const SPARE: { country: string; kt: number; note: string }[] = [
  { country: 'Vietnam', kt: 0.4, note: 'Part of its refining feed is Chinese concentrate' },
  { country: 'Bolivia', kt: 0.2, note: 'Small scale; qualification of suppliers unknown' },
  { country: 'Portugal', kt: 0.1, note: 'Mine-life limited' },
  { country: 'Rwanda', kt: 0.1, note: 'Conflict risk elevated in producing regions' },
  { country: 'Austria', kt: 0.05, note: 'Refining depends partly on imported concentrate' },
  { country: 'Russia', kt: 0.2, note: 'Sanctions screening applies; not a practical alternative for this buyer' },
]
