// Prototype data and scoring for the supplier dashboard (S12) and comparison (S03).
// Everything here is REPRESENTATIVE: invented suppliers and numbers shaped like the Credibl
// products (C-02, C-05, C-07, C-08, C-10, C-11, C-12) and client quotes. The scoring follows
// Scope of Work v0.7 (1 = most favourable, green < 2.5, red > 3.5, ranking needs 70% of
// applicable metrics and at least one per dimension). Replace with API data in the build.

export type Dim = 'price' | 'security' | 'logistics' | 'geo'
export type Rating = 'green' | 'amber' | 'red' | 'unknown'

export const DIMS: { id: Dim; label: string; short: string }[] = [
  { id: 'price', label: 'Price and total cost', short: 'Price' },
  { id: 'security', label: 'Supply security', short: 'Security' },
  { id: 'logistics', label: 'Logistics', short: 'Logistics' },
  { id: 'geo', label: 'Geopolitical and regulatory risk', short: 'Geo & reg.' },
]

export const DEFAULT_WEIGHTS: Record<Dim, number> = { price: 30, security: 30, logistics: 15, geo: 25 }

// Settings the delivery team maintains (Configuration screen, later); not hard-coded in the build.
export const CONFIG = {
  comparisonLimit: 10,
  greenBelow: 2.5,
  redAbove: 3.5,
  minCoverage: 0.7,
  referencePriceUsdPerT: 41000, // APT reference price, indicative (C-04)
  referencePriceAsOf: '2026-11-15',
  contentWo3: 0.88, // WO3 content of APT, used for the per-tonne WO3 view
  indicativeFreightPct: 0.03,
}

export interface Requirement {
  commodity: 'Tungsten'
  form: string
  grade: string
  volumeT: number
  timeframe: string
  delivery: string
}

export const DEFAULT_REQUIREMENT: Requirement = {
  commodity: 'Tungsten',
  form: 'APT',
  grade: 'Standard',
  volumeT: 50,
  timeframe: '12 months',
  delivery: 'Rotterdam (representative)',
}
export const FORMS = ['APT', 'WO3', 'FeW']
export const GRADES = ['Standard', 'High purity']
export const TIMEFRAMES = ['6 months', '12 months', '24 months']

export type MetricId = 'sec_conc' | 'sec_cap' | 'log_route' | 'log_lead' | 'geo_conflict' | 'geo_export' | 'geo_tariff' | 'geo_hazard'

export interface MetricDef {
  id: MetricId
  dim: Exclude<Dim, 'price'>
  label: string
  product: string
  source: string
  asOf: string
  refreshed: string
  stale?: boolean
  licence: string
  note: string
}

export const METRICS: MetricDef[] = [
  { id: 'sec_conc', dim: 'security', label: 'Origin concentration (country share of world supply)', product: 'C-02 / C-07', source: 'USGS Mineral Commodity Summaries', asOf: '2026-10-27', refreshed: '2026-11-25', licence: 'Public domain. Source: U.S. Geological Survey', note: 'Higher share in one country scores worse.' },
  { id: 'sec_cap', dim: 'security', label: 'Producer capacity and mine life', product: 'C-05', source: 'Company filings and technical reports (listed producers only)', asOf: '2026-07-28', refreshed: '2026-11-20', licence: 'Public filings. Compiled by Credibl', note: 'Refreshed annually. Not disclosed by most Chinese producers.' },
  { id: 'log_route', dim: 'logistics', label: 'Route and chokepoint risk', product: 'C-11 / C-07', source: 'IMF PortWatch', asOf: '2026-11-24', refreshed: '2026-11-25', licence: 'Public domain. Source: IMF PortWatch', note: 'Malacca and Red Sea transit exposure for the origin route.' },
  { id: 'log_lead', dim: 'logistics', label: 'Quoted lead time', product: 'Client quote', source: 'Client quote (Excel upload)', asOf: '2026-11-20', refreshed: '2026-11-20', licence: 'Client data', note: 'Only available once a quote is loaded.' },
  { id: 'geo_conflict', dim: 'geo', label: 'Conflict intensity at origin', product: 'C-07', source: 'UCDP georeferenced events (annual baseline)', asOf: '2026-04-30', refreshed: '2026-11-10', stale: true, licence: 'Attribution required. Source: UCDP, Uppsala University', note: 'Baseline only; stale between annual releases.' },
  { id: 'geo_export', dim: 'geo', label: 'Export-control exposure', product: 'C-08', source: 'MOFCOM and GACC notices (translated, reviewed)', asOf: '2026-11-20', refreshed: '2026-11-25', licence: 'Public notice. Translation by Credibl', note: 'AI-extracted and human-reviewed before it affects a score.' },
  { id: 'geo_tariff', dim: 'geo', label: 'Tariff exposure', product: 'C-10', source: 'WTO / USITC tariff schedules', asOf: '2026-09-30', refreshed: '2026-11-18', licence: 'Public domain', note: 'Tariff on the origin and destination pair.' },
  { id: 'geo_hazard', dim: 'geo', label: 'Site hazard exposure', product: 'C-12', source: 'Prepared physical-hazard layers', asOf: '2026-06-30', refreshed: '2026-11-18', licence: 'Attribution required; rights to be confirmed', note: 'Consumed only with approved rights.' },
]
export const METRIC_BY_ID = Object.fromEntries(METRICS.map((m) => [m.id, m])) as Record<MetricId, MetricDef>
// applicable metrics = the eight above plus the landed-cost metric under Price
export const APPLICABLE_METRICS = METRICS.length + 1

export type Stage = 'Producing' | 'Ramp-up' | 'Development' | 'Exploration'
export type AssetType = 'Mine' | 'Refinery' | 'Project'
export type Qualification = 'qualified' | 'pending' | 'not_qualified' | 'unknown'
export type Sanctions = 'clear' | 'review' | 'match'
export type Rmi = 'conformant' | 'not_conformant' | 'unknown' | 'na'

export interface Quote { priceUsdPerT: number; freightUsd: number; tariffPct: number; leadWeeks: number; quotedOn: string; missing?: ('freight' | 'tariff')[] }

// Quotes loaded through Data & Quotes override the preloaded sample; null means the quote was removed.
let quoteOverrides: Record<string, Quote | null> = {}
export const setQuoteOverrides = (o: Record<string, Quote | null>) => { quoteOverrides = o }


export interface Supplier {
  id: string
  name: string
  country: string
  assetType: AssetType
  stage: Stage
  capacityT: number | null // tonnes APT-equivalent per year
  forms: string[]
  qualification: Qualification
  sanctions: Sanctions
  rmi: Rmi
  quote: Quote | null
  scores: Partial<Record<Exclude<MetricId, 'log_lead'>, number>>
  note?: string
}

// Supplier Master overrides: qualification per product form, extra aliases and site details.
let qualOverrides: Record<string, Record<string, Qualification>> = {}
export const setQualOverrides = (o: Record<string, Record<string, Qualification>>) => { qualOverrides = o }
// A form with no Supplier Master record falls back to the registry status for APT and is unknown otherwise.
export const qualFor = (s: Supplier, form: string): Qualification => qualOverrides[s.id]?.[form] ?? (form === 'APT' ? s.qualification : 'unknown')
let siteOverrides: Record<string, Partial<SiteProfile>> = {}
export const setSiteOverrides = (o: Record<string, Partial<SiteProfile>>) => { siteOverrides = o }
const NO_SITE: SiteProfile = { site: 'Not recorded', lat: NaN, lon: NaN, owner: 'Not recorded', timeline: 'Not recorded' }
export const siteOf = (s: Supplier): SiteProfile => Object.assign({}, NO_SITE, SITE[s.id], siteOverrides[s.id])
export const hasCoords = (s: Supplier) => Number.isFinite(siteOf(s).lat) && Number.isFinite(siteOf(s).lon)

export const quoteOf = (s: Supplier): Quote | null => (s.id in quoteOverrides ? quoteOverrides[s.id] : s.quote)
export const EMERGING_STAGES: Stage[] = ['Exploration', 'Development', 'Ramp-up']
export const isEmerging = (s: Supplier) => EMERGING_STAGES.includes(s.stage)

const q = (priceUsdPerT: number, freightUsd: number, tariffPct: number, leadWeeks: number): Quote => ({ priceUsdPerT, freightUsd, tariffPct, leadWeeks, quotedOn: '2026-11-20' })

export const SUPPLIERS: Supplier[] = [
  { id: 'A', name: 'Ardenne Tungsten Refining', country: 'Austria', assetType: 'Refinery', stage: 'Producing', capacityT: 1200, forms: ['APT', 'WO3'], qualification: 'qualified', sanctions: 'clear', rmi: 'conformant',
    quote: q(40000, 60000, 0, 8), scores: { sec_conc: 2.0, sec_cap: 1.8, log_route: 1.8, geo_conflict: 1.2, geo_export: 1.5, geo_tariff: 1.5, geo_hazard: 1.6 } },
  { id: 'B', name: 'Bao Viet Tungsten', country: 'Vietnam', assetType: 'Refinery', stage: 'Producing', capacityT: 2800, forms: ['APT', 'WO3', 'FeW'], qualification: 'qualified', sanctions: 'clear', rmi: 'conformant',
    quote: q(38000, 120000, 5, 10), scores: { sec_conc: 4.0, sec_cap: 2.6, log_route: 3.2, geo_conflict: 2.2, geo_export: 3.9, geo_tariff: 3.0, geo_hazard: 2.8 }, note: 'Lowest unit price, but feed is concentrated in one country with export controls.' },
  { id: 'C', name: 'Costa Alta Mining', country: 'Portugal', assetType: 'Mine', stage: 'Producing', capacityT: 700, forms: ['APT', 'WO3'], qualification: 'qualified', sanctions: 'clear', rmi: 'na',
    quote: q(41000, 45000, 0, 6), scores: { sec_conc: 1.8, sec_cap: 2.4, log_route: 1.9, geo_conflict: 1.3, geo_export: 1.4, geo_tariff: 1.4, geo_hazard: 1.9 } },
  { id: 'D', name: 'Dnepr Metallurgical', country: 'Russia', assetType: 'Refinery', stage: 'Producing', capacityT: 1500, forms: ['APT', 'WO3'], qualification: 'qualified', sanctions: 'match', rmi: 'unknown',
    quote: q(36500, 140000, 5, 14), scores: { sec_conc: 3.8, sec_cap: 3.0, log_route: 3.9, geo_conflict: 3.8, geo_export: 3.2, geo_tariff: 3.5, geo_hazard: 2.5 }, note: 'Named-entity sanctions match.' },
  { id: 'E', name: 'Eyre Basin Tungsten', country: 'Australia', assetType: 'Project', stage: 'Ramp-up', capacityT: 400, forms: ['APT'], qualification: 'pending', sanctions: 'clear', rmi: 'na',
    quote: null, scores: { sec_conc: 1.6, sec_cap: 3.4, log_route: 2.3, geo_conflict: 1.2, geo_export: 1.3, geo_tariff: 1.8, geo_hazard: 2.9 }, note: 'Emerging supplier; no quote received.' },
  { id: 'F', name: 'Fergana Minerals', country: 'Kazakhstan', assetType: 'Mine', stage: 'Producing', capacityT: null, forms: ['APT'], qualification: 'unknown', sanctions: 'clear', rmi: 'na',
    quote: null, scores: { sec_conc: 2.8, log_route: 3.0, geo_conflict: 2.0, geo_export: 2.5 }, note: 'Capacity, tariff and hazard data not available; no quote.' },
  { id: 'G', name: 'Gannan Smelting', country: 'China', assetType: 'Refinery', stage: 'Producing', capacityT: 25000, forms: ['APT', 'WO3', 'FeW'], qualification: 'qualified', sanctions: 'clear', rmi: 'not_conformant',
    quote: q(34500, 150000, 7.5, 9), scores: { sec_conc: 5.0, sec_cap: 1.5, log_route: 3.6, geo_conflict: 1.8, geo_export: 4.6, geo_tariff: 3.8, geo_hazard: 3.0 }, note: 'Smelter is not on the RMI conformant list.' },
  { id: 'H', name: 'Huye Highlands Mining', country: 'Rwanda', assetType: 'Mine', stage: 'Producing', capacityT: 600, forms: ['WO3'], qualification: 'pending', sanctions: 'clear', rmi: 'na',
    quote: q(39500, 95000, 0, 12), scores: { sec_conc: 2.5, sec_cap: 3.1, log_route: 3.4, geo_conflict: 4.3, geo_export: 2.2, geo_tariff: 2.4, geo_hazard: 3.2 } },
  { id: 'I', name: 'Illimani Resources', country: 'Bolivia', assetType: 'Mine', stage: 'Producing', capacityT: 40, forms: ['WO3'], qualification: 'unknown', sanctions: 'clear', rmi: 'na',
    quote: null, scores: { sec_conc: 2.4, sec_cap: 3.6, log_route: 3.3, geo_conflict: 2.6, geo_export: 2.0, geo_tariff: 2.2, geo_hazard: 3.1 } },
  { id: 'J', name: 'Jackson Ridge Project', country: 'United States', assetType: 'Project', stage: 'Development', capacityT: 900, forms: ['APT'], qualification: 'unknown', sanctions: 'clear', rmi: 'na',
    quote: null, scores: { sec_conc: 1.5, sec_cap: 3.8, log_route: 2.0, geo_conflict: 1.1, geo_export: 1.2, geo_tariff: 2.0, geo_hazard: 2.4 }, note: 'Emerging; development stage, timeline to be confirmed.' },
  { id: 'K', name: 'Kluane Exploration', country: 'Canada', assetType: 'Project', stage: 'Exploration', capacityT: null, forms: ['APT'], qualification: 'unknown', sanctions: 'clear', rmi: 'na',
    quote: null, scores: { sec_conc: 1.4, log_route: 2.1, geo_conflict: 1.0, geo_export: 1.1, geo_tariff: 1.6 }, note: 'Emerging; exploration stage, no capacity disclosed.' },
  { id: 'L', name: 'Lee & Han Materials', country: 'South Korea', assetType: 'Refinery', stage: 'Producing', capacityT: 2200, forms: ['APT', 'WO3'], qualification: 'qualified', sanctions: 'clear', rmi: 'conformant',
    quote: q(42500, 50000, 0, 7), scores: { sec_conc: 2.9, sec_cap: 2.0, log_route: 2.6, geo_conflict: 2.4, geo_export: 2.3, geo_tariff: 1.7, geo_hazard: 2.2 } },
  { id: 'M', name: 'Mantaro Metals', country: 'Brazil', assetType: 'Mine', stage: 'Producing', capacityT: 45, forms: ['WO3'], qualification: 'pending', sanctions: 'clear', rmi: 'na',
    quote: null, scores: { sec_conc: 2.2, sec_cap: 2.9, log_route: 2.8, geo_conflict: 2.1, geo_export: 1.9, geo_tariff: 2.6, geo_hazard: 2.7 } },
  { id: 'N', name: 'Nay Pyi Ore Traders', country: 'Myanmar', assetType: 'Mine', stage: 'Producing', capacityT: null, forms: ['WO3'], qualification: 'unknown', sanctions: 'review', rmi: 'na',
    quote: null, scores: { sec_conc: 3.0, log_route: 3.7, geo_conflict: 4.6, geo_export: 2.8, geo_tariff: 2.5 }, note: 'Possible sanctions match to be reviewed.' },
]
export const SUPPLIER_BY_ID = Object.fromEntries(SUPPLIERS.map((s) => [s.id, s])) as Record<string, Supplier>

export const ratingOf = (score: number | null): Rating =>
  score == null ? 'unknown' : score < CONFIG.greenBelow ? 'green' : score > CONFIG.redAbove ? 'red' : 'amber'
const RANK: Record<Rating, number> = { unknown: -1, green: 0, amber: 1, red: 2 }
export const worst = (rs: Rating[]): Rating => rs.reduce<Rating>((a, b) => (RANK[b] > RANK[a] ? b : a), 'unknown')
export const RATING_LABEL: Record<Rating, string> = { green: 'Green', amber: 'Amber', red: 'Red', unknown: 'Unknown' }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export interface LandedCost {
  indicative: boolean
  goods: number
  freight: number
  tariff: number
  total: number
  perTonneWo3: number
  note: string
}

// China export-licence tightening (Credibl scenario template C-13, simulated). Inputs: severity (share of licensed
// volume withdrawn), duration and destination. Effects are ranges; the mid-point is applied to re-score the suppliers.
export interface Scenario { severity: number; durationMonths: number; destination: string }
export const DEFAULT_SCENARIO: Scenario = { severity: 50, durationMonths: 6, destination: 'Netherlands' }
export const DESTINATIONS = ['Netherlands', 'Germany', 'United States', 'Japan', 'South Korea']
// share of each supplier's feed or processing that depends on China (representative; exposure, not predicted interruption)
export const CHINA_DEP: Record<string, number> = { A: 0.2, B: 0.7, C: 0, D: 0.3, E: 0, F: 0.1, G: 1, H: 0.1, I: 0.1, J: 0, K: 0, L: 0.6, M: 0, N: 0.2 }
export function scenarioEffects(sc: Scenario) {
  const sev = sc.severity / 100
  const dur = 0.5 + Math.min(sc.durationMonths, 12) / 12
  const e = { priceLow: sev * 0.1 * dur, priceHigh: sev * 0.3 * dur, leadLow: sev * 2 * dur, leadHigh: sev * 6 * dur }
  return { ...e, priceMid: (e.priceLow + e.priceHigh) / 2, leadMid: (e.leadLow + e.leadHigh) / 2, sev }
}

export function landedCost(s: Supplier, volumeT: number, sc?: Scenario): LandedCost {
  const wo3 = volumeT * CONFIG.contentWo3
  const quote = quoteOf(s)
  const uplift = sc ? 1 + (CHINA_DEP[s.id] ?? 0) * scenarioEffects(sc).priceMid : 1
  if (quote) {
    const goods = volumeT * quote.priceUsdPerT * uplift
    const tariff = Math.round((goods * quote.tariffPct) / 100)
    const total = goods + quote.freightUsd + tariff
    const gaps = quote.missing?.length ? ` Not supplied in the quote: ${quote.missing.join(' and ')} (counted as zero and flagged).` : ''
    return { indicative: false, goods, freight: quote.freightUsd, tariff, total, perTonneWo3: total / wo3, note: `Quote of ${quote.quotedOn}: ${quote.priceUsdPerT.toLocaleString('en-GB')} USD/t.${gaps}` }
  }
  const goods = volumeT * CONFIG.referencePriceUsdPerT * uplift
  const freight = Math.round(goods * CONFIG.indicativeFreightPct)
  const total = goods + freight
  return { indicative: true, goods, freight, tariff: 0, total, perTonneWo3: total / wo3, note: `No quote. APT reference price ${CONFIG.referencePriceUsdPerT.toLocaleString('en-GB')} USD/t (${CONFIG.referencePriceAsOf}); freight, insurance and handling assumed at ${CONFIG.indicativeFreightPct * 100}% of goods value; duties not estimated.` }
}

// Prototype price score: landed cost per tonne against the reference price, 1 at 95% or less, 5 at 115% or more.
export function priceScore(lc: LandedCost, volumeT: number): number {
  const r = lc.total / volumeT / CONFIG.referencePriceUsdPerT
  return clamp(1 + (4 * (r - 0.95)) / 0.2, 1, 5)
}

export function metricScore(s: Supplier, id: MetricId, sc?: Scenario): number | null {
  const dep = sc ? CHINA_DEP[s.id] ?? 0 : 0
  const fx = sc ? scenarioEffects(sc) : null
  if (id === 'log_lead') {
    const quote = quoteOf(s)
    if (!quote) return null
    return clamp(1 + (4 * (quote.leadWeeks + (fx ? dep * fx.leadMid : 0) - 4)) / 12, 1, 5)
  }
  const v = s.scores[id as Exclude<MetricId, 'log_lead'>]
  if (v == null) return null
  if (fx && id === 'sec_conc') return clamp(v + 1.5 * dep * fx.sev, 1, 5)
  if (fx && id === 'geo_export') return clamp(v + 2 * dep * fx.sev, 1, 5)
  return v
}

export function dimensionScore(s: Supplier, dim: Dim, volumeT: number, sc?: Scenario): number | null {
  if (dim === 'price') return priceScore(landedCost(s, volumeT, sc), volumeT)
  return mean(METRICS.filter((m) => m.dim === dim).map((m) => metricScore(s, m.id, sc)).filter((x): x is number => x != null))
}

export function dashboardRatings(s: Supplier): Record<Exclude<Dim, 'price'>, Rating> {
  return { security: ratingOf(dimensionScore(s, 'security', 0)), logistics: ratingOf(dimensionScore(s, 'logistics', 0)), geo: ratingOf(dimensionScore(s, 'geo', 0)) }
}
export const headline = (s: Supplier): Rating => worst(Object.values(dashboardRatings(s)))

// share of applicable metrics with data; price always has a cost, quoted or indicative (same basis as the 70% rule)
export const completeness = (s: Supplier) => (APPLICABLE_METRICS - METRICS.filter((m) => metricScore(s, m.id) == null).length) / APPLICABLE_METRICS

export type Status = 'ranked' | 'excluded' | 'insufficient' | 'review'

export interface Assessment {
  supplier: Supplier
  status: Status
  reasons: string[]
  missing: string[]
  coverage: number
  landed: LandedCost
  dims: Record<Dim, number | null>
  overall: number | null
}

export function assess(s: Supplier, weights: Record<Dim, number>, req: Requirement, sc?: Scenario): Assessment {
  const landed = landedCost(s, req.volumeT, sc)
  const dims = Object.fromEntries(DIMS.map((d) => [d.id, dimensionScore(s, d.id, req.volumeT, sc)])) as Record<Dim, number | null>
  const missing = METRICS.filter((m) => metricScore(s, m.id) == null).map((m) => m.label)
  const have = APPLICABLE_METRICS - missing.length
  const coverage = have / APPLICABLE_METRICS
  const reasons: string[] = []
  let status: Status = 'ranked'

  if (s.sanctions === 'match') reasons.push('Sanctions match (named entity)')
  if (qualFor(s, req.form) === 'not_qualified') reasons.push(`Material not qualified for ${req.form}`)
  if (!s.forms.includes(req.form)) reasons.push(`Does not offer ${req.form}`)
  if (s.rmi === 'not_conformant') reasons.push('Smelter is not on the RMI conformant list')
  if (reasons.length) status = 'excluded'
  else if (s.sanctions === 'review') { status = 'review'; reasons.push('Sanctions screening is not cleared: a possible match or a supplier not yet screened is awaiting analyst review') }
  else {
    const dimMissing = DIMS.filter((d) => dims[d.id] == null).map((d) => d.short)
    if (coverage < CONFIG.minCoverage || dimMissing.length) {
      status = 'insufficient'
      reasons.push(`${Math.round(coverage * 100)}% of applicable metrics have data; at least ${CONFIG.minCoverage * 100}% and one per dimension are needed`)
      if (dimMissing.length) reasons.push(`No data for: ${dimMissing.join(', ')}`)
    }
  }
  const overall = status === 'ranked' ? DIMS.reduce((acc, d) => acc + (weights[d.id] / 100) * (dims[d.id] as number), 0) : null
  return { supplier: s, status, reasons, missing, coverage, landed, dims, overall }
}

export const weightsTotal = (w: Record<Dim, number>) => DIMS.reduce((a, d) => a + (Number.isFinite(w[d.id]) ? w[d.id] : 0), 0)

export function compare(ids: string[], weights: Record<Dim, number>, req: Requirement, sc?: Scenario) {
  const all = ids.map((id) => SUPPLIER_BY_ID[id]).filter(Boolean).map((s) => assess(s, weights, req, sc))
  const ranked = all.filter((a) => a.status === 'ranked').sort((a, b) => (a.overall! - b.overall!) || (a.landed.total - b.landed.total))
  return { ranked, excluded: all.filter((a) => a.status === 'excluded'), insufficient: all.filter((a) => a.status === 'insufficient'), review: all.filter((a) => a.status === 'review') }
}

export const usd = (n: number) => `USD ${Math.round(n).toLocaleString('en-GB')}`
export const fmtDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })

// Site, ownership and timeline from the registry (C-05). Representative; ownership exposure itself is not screened.
export interface SiteProfile { site: string; lat: number; lon: number; owner: string; timeline: string }
export const SITE: Record<string, SiteProfile> = {
  A: { site: 'Graz refinery', lat: 47.07, lon: 15.44, owner: 'Ardenne Holding (private)', timeline: 'In production; expansion study for 2027' },
  B: { site: 'Thai Nguyen complex', lat: 21.59, lon: 105.84, owner: 'Bao Viet Group (listed)', timeline: 'In production; second line commissioned 2025' },
  C: { site: 'Panasqueira district', lat: 40.15, lon: -7.75, owner: 'Costa Alta Resources (listed)', timeline: 'In production; reserve life to about 2036' },
  D: { site: 'Yekaterinburg works', lat: 56.84, lon: 60.61, owner: 'Dnepr Metallurgical (state-linked)', timeline: 'In production' },
  E: { site: 'Eyre Peninsula project', lat: -33.8, lon: 136.0, owner: 'Eyre Basin Ltd (listed)', timeline: 'Ramp-up to nameplate capacity expected 2027' },
  F: { site: 'Karaganda deposit', lat: 49.8, lon: 73.1, owner: 'Not disclosed', timeline: 'In production; no filings available' },
  G: { site: 'Ganzhou smelter', lat: 25.83, lon: 114.93, owner: 'Gannan Group (state-owned)', timeline: 'In production' },
  H: { site: 'Huye highlands', lat: -2.6, lon: 29.74, owner: 'Huye Mining (private)', timeline: 'In production' },
  I: { site: 'Potosí district', lat: -19.58, lon: -65.75, owner: 'Illimani Resources (private)', timeline: 'In production' },
  J: { site: 'Idaho deposit', lat: 44.4, lon: -114.2, owner: 'Jackson Ridge Inc. (listed)', timeline: 'Feasibility complete; construction decision pending' },
  K: { site: 'Kluane claims', lat: 61.5, lon: -138.0, owner: 'Kluane Exploration (listed)', timeline: 'Drilling; no resource estimate yet' },
  L: { site: 'Gyeonggi refinery', lat: 37.2, lon: 127.3, owner: 'Lee & Han Materials (listed)', timeline: 'In production' },
  M: { site: 'Seridó mine', lat: -6.0, lon: -36.5, owner: 'Mantaro Metals (private)', timeline: 'In production' },
  N: { site: 'Tanintharyi area', lat: 12.0, lon: 99.0, owner: 'Not disclosed', timeline: 'Unknown' },
}

// ---- weighting profiles (Could), robustness check (Should) and trade-off summary (Should) ----
export const PROFILES: { id: string; label: string; weights: Record<Dim, number> }[] = [
  { id: 'balanced', label: 'Balanced', weights: { price: 25, security: 25, logistics: 25, geo: 25 } },
  { id: 'cost', label: 'Cost-led', weights: { price: 50, security: 20, logistics: 10, geo: 20 } },
  { id: 'security', label: 'Security-led', weights: { price: 15, security: 45, logistics: 15, geo: 25 } },
]

export type Comparison = ReturnType<typeof compare>

export interface RobustnessRow { label: string; leader: string | null; same: boolean }
// Does the leading supplier change under the default weightings, each profile and the export-licence scenario?
export function robustness(ids: string[], req: Requirement, current: Record<Dim, number>, sc: Scenario): { rows: RobustnessRow[]; currentLeader: string | null } {
  const lead = (w: Record<Dim, number>, scenario?: Scenario) => compare(ids, w, req, scenario).ranked[0]?.supplier.name ?? null
  const currentLeader = lead(current)
  const mk = (label: string, leader: string | null): RobustnessRow => ({ label, leader, same: leader === currentLeader })
  return {
    currentLeader,
    rows: [
      mk('Default weightings', lead(DEFAULT_WEIGHTS)),
      ...PROFILES.map((p) => mk(`${p.label} profile`, lead(p.weights))),
      mk(`China export-licence scenario (${sc.severity}% withdrawn, ${sc.durationMonths} months)`, lead(current, sc)),
    ],
  }
}

export function tradeoffSummary(result: Comparison, req: Requirement): string[] {
  const { ranked } = result
  if (ranked.length === 0) return []
  const out: string[] = []
  const first = ranked[0]
  const best = (a: Assessment) => DIMS.filter((d) => d.id !== 'price').reduce((x, y) => ((a.dims[x.id] ?? 9) <= (a.dims[y.id] ?? 9) ? x : y))
  const worstDim = (a: Assessment) => DIMS.reduce((x, y) => ((a.dims[x.id] ?? 0) >= (a.dims[y.id] ?? 0) ? x : y))
  const cheapestLanded = [...ranked].sort((a, b) => a.landed.total - b.landed.total)[0]
  out.push(`${first.supplier.name} ranks first with an overall score of ${first.overall!.toFixed(1)}: ${first.landed.indicative ? 'its cost is indicative (no quote)' : `landed cost ${usd(first.landed.total)}`}, strongest on ${best(first).label.toLowerCase()} and weakest on ${worstDim(first).label.toLowerCase()} (${(first.dims[worstDim(first).id] ?? 0).toFixed(1)}).`)
  if (ranked[1]) {
    const second = ranked[1]
    const gap = second.overall! - first.overall!
    out.push(`${second.supplier.name} is second, ${gap.toFixed(1)} points behind${second.landed.total < first.landed.total ? ` although its landed cost is ${usd(first.landed.total - second.landed.total)} lower` : ` and ${usd(second.landed.total - first.landed.total)} more expensive`}.`)
  }
  const lowestUnit = ranked.filter((a) => !a.landed.indicative).map((a) => ({ a, unit: quoteOf(a.supplier)!.priceUsdPerT })).sort((x, y) => x.unit - y.unit)[0]
  if (lowestUnit && lowestUnit.a.supplier.id !== cheapestLanded.supplier.id) {
    out.push(`${lowestUnit.a.supplier.name} quotes the lowest unit price (${usd(lowestUnit.unit)} per tonne) but is not the cheapest delivered: freight${lowestUnit.a.landed.tariff ? ', insurance, handling and a tariff' : ' and handling'} bring landed cost to ${usd(lowestUnit.a.landed.total)}, against ${usd(cheapestLanded.landed.total)} for ${cheapestLanded.supplier.name}.`)
  }
  const emerging = ranked.filter((a) => isEmerging(a.supplier))
  if (emerging.length) out.push(`${emerging.map((a) => a.supplier.name).join(' and ')} ${emerging.length > 1 ? 'are emerging suppliers' : 'is an emerging supplier'}${emerging.some((a) => a.landed.indicative) ? ' and priced from the reference price, so confidence is lower' : ''}.`)
  const out2 = result.excluded.length + result.insufficient.length + result.review.length
  if (out2) out.push(`${out2} selected supplier${out2 > 1 ? 's are' : ' is'} not ranked (excluded, held for review or short of data); the reasons are listed below the ranking.`)
  out.push(`Based on ${req.volumeT} t of ${req.form} over ${req.timeframe}. Scores support the decision; they do not predict supply loss.`)
  return out
}
