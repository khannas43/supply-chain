import { useSyncExternalStore } from 'react'
import {
  CONFIG, DEFAULT_WEIGHTS, qualFor, DIMS, METRICS, PROFILES, SUPPLIER_BY_ID, compare, metricScore, quoteOf, ratingOf, robustness, tradeoffSummary,
  type Dim, type Requirement, type Scenario,
} from './data'

// The decision pack as plain data, so an issued pack is a frozen snapshot that later quote or weighting changes cannot alter.
export interface PackSupplier { id: string; name: string; country: string; emerging: boolean; status: string; reasons: string[]; missing: string[]; total: number; indicative: boolean }
export interface PackRanked { rank: number; id: string; name: string; overall: number; dims: Record<Dim, number>; ratings: Record<Dim, string>; total: number; perTonneWo3: number; indicative: boolean; goods: number; freight: number; tariff: number; costNote: string }
export interface PackDetail { name: string; country: string; metrics: { label: string; score: number | null; rating: string; source: string; asOf: string; licence: string; stale: boolean }[] }
export interface PackData {
  generatedAt: string
  requirement: Requirement
  recommendation: { id: string; name: string; rationale: string; reasons: string[] }
  considered: PackSupplier[]
  ranked: PackRanked[]
  weights: Record<Dim, number>
  differsFromDefault: boolean
  defaultRanking: string[]
  robustness: { label: string; leader: string | null; same: boolean }[]
  scenario: Scenario
  detail: PackDetail[]
  gaps: string[]
  assumptions: string[]
  confidence: string
}

export function buildPack(args: { ids: string[]; req: Requirement; weights: Record<Dim, number>; scenario: Scenario; recommendId: string; rationale: string }): PackData {
  const { ids, req, weights, scenario, recommendId, rationale } = args
  const res = compare(ids, weights, req)
  const rec = SUPPLIER_BY_ID[recommendId]
  const differs = DIMS.some((d) => weights[d.id] !== DEFAULT_WEIGHTS[d.id])
  const all = [...res.ranked, ...res.excluded, ...res.review, ...res.insufficient]

  const ranked: PackRanked[] = res.ranked.map((a, i) => ({
    rank: i + 1, id: a.supplier.id, name: a.supplier.name, overall: a.overall!,
    dims: a.dims as Record<Dim, number>,
    ratings: Object.fromEntries(DIMS.map((d) => [d.id, ratingOf(a.dims[d.id])])) as Record<Dim, string>,
    total: a.landed.total, perTonneWo3: a.landed.perTonneWo3, indicative: a.landed.indicative, goods: a.landed.goods, freight: a.landed.freight, tariff: a.landed.tariff, costNote: a.landed.note,
  }))
  const top = ranked.find((r) => r.id === recommendId)
  const reasons: string[] = []
  if (top) {
    reasons.push(`Ranks ${top.rank} of ${ranked.length} with an overall score of ${top.overall.toFixed(1)} (1 = most favourable).`)
    reasons.push(`${top.indicative ? 'Indicative' : 'Quoted'} total landed cost ${Math.round(top.total).toLocaleString('en-GB')} USD for ${req.volumeT} t of ${req.form}.`)
    const best = DIMS.filter((d) => ratingOf(top.dims[d.id]) === 'green').map((d) => d.short)
    if (best.length) reasons.push(`Green on ${best.join(', ')}.`)
  }
  const robust = robustness(ids, req, weights, scenario)

  const detail: PackDetail[] = ranked.slice(0, 3).map((r) => {
    const s = SUPPLIER_BY_ID[r.id]
    return {
      name: s.name, country: s.country,
      metrics: METRICS.map((m) => {
        const v = metricScore(s, m.id)
        return { label: m.label, score: v, rating: ratingOf(v), source: m.source, asOf: m.asOf, licence: m.licence, stale: !!m.stale }
      }),
    }
  })

  const gaps: string[] = []
  for (const a of all) {
    if (a.status === 'insufficient') gaps.push(`${a.supplier.name}: not ranked; ${a.missing.length} metrics lack data.`)
    const q = quoteOf(a.supplier)
    if (a.landed.indicative) gaps.push(`${a.supplier.name}: no quote; price is indicative.`)
    if (q?.missing?.length) gaps.push(`${a.supplier.name}: ${q.missing.join(' and ')} not supplied in the quote.`)
    if (qualFor(a.supplier, req.form) !== 'qualified') gaps.push(`${a.supplier.name}: qualification for ${req.form} is ${qualFor(a.supplier, req.form).replace('_', ' ')}.`)
  }
  gaps.push('Ownership exposure is not screened (named-entity sanctions screening only).')
  gaps.push('Conflict scores use an annual baseline and may be stale between releases.')

  return {
    generatedAt: new Date().toISOString(),
    requirement: req,
    recommendation: { id: recommendId, name: rec?.name ?? recommendId, rationale, reasons },
    considered: all.map((a) => ({
      id: a.supplier.id, name: a.supplier.name, country: a.supplier.country, emerging: ['Exploration', 'Development', 'Ramp-up'].includes(a.supplier.stage),
      status: a.status === 'ranked' ? 'Ranked' : a.status === 'excluded' ? 'Excluded' : a.status === 'review' ? 'Review required' : 'Insufficient data',
      reasons: a.reasons, missing: a.status === 'insufficient' ? a.missing : [], total: a.landed.total, indicative: a.landed.indicative,
    })),
    ranked, weights: { ...weights }, differsFromDefault: differs,
    defaultRanking: differs ? compare(ids, DEFAULT_WEIGHTS, req).ranked.map((a) => a.supplier.name) : [],
    robustness: robust.rows.map((r) => ({ label: r.label, leader: r.leader, same: r.same })), scenario: { ...scenario },
    detail, gaps,
    assumptions: [
      `Scores run from 1 (most favourable) to 5; green below ${CONFIG.greenBelow}, red above ${CONFIG.redAbove}.`,
      `A supplier is ranked only if at least ${CONFIG.minCoverage * 100}% of applicable metrics have data and every dimension has at least one.`,
      'Landed cost covers only costs documented in quotes and terms; financing and storage are not estimated.',
      `Indicative prices use the APT reference price of USD ${CONFIG.referencePriceUsdPerT.toLocaleString('en-GB')} per tonne (${CONFIG.referencePriceAsOf}).`,
      'All data in this prototype is representative; Credibl values come from an API-shaped stand-in.',
      'Scores support the decision; they do not predict supply loss. The pack supports, and does not replace, the client’s own procurement and due-diligence processes.',
    ],
    confidence: 'Each metric carries its source and date in section 7; quoted prices carry the quote date.',
  }
}

export { PROFILES, tradeoffSummary }

// ---- decision record and issued packs ----
export type ReviewOutcome = 'confirmed' | 'returned'
export interface DecisionDraft {
  recommendId: string | null
  rationale: string
  recordedBy: string | null
  recordedAt: string | null
  submitted: boolean
  review: { by: string; at: string; outcome: ReviewOutcome; comment: string } | null
}
export interface IssuedPack { version: number; issuedAt: string; issuedBy: string; reviewedBy: string; data: PackData }
interface State { draft: DecisionDraft; packs: IssuedPack[] }

const EMPTY: DecisionDraft = { recommendId: null, rationale: '', recordedBy: null, recordedAt: null, submitted: false, review: null }
const KEY = 'proto.decision.v1'
function load(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (v && v.draft && Array.isArray(v.packs)) return v
  } catch { /* defaults */ }
  return { draft: EMPTY, packs: [] }
}
let state = load()
const listeners = new Set<() => void>()
const emit = (next: State) => {
  state = next
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useDecision = () => useSyncExternalStore(subscribe, () => state)

export const editDraft = (patch: Partial<DecisionDraft>) => {
  // any change to the recommendation or rationale after submission reopens the review
  const reopen = ('recommendId' in patch || 'rationale' in patch) && (state.draft.submitted || state.draft.review)
  emit({ ...state, draft: { ...state.draft, ...patch, ...(reopen ? { submitted: false, review: null } : {}) } })
}
export const submitForReview = (by: string) => emit({ ...state, draft: { ...state.draft, recordedBy: by, recordedAt: new Date().toISOString(), submitted: true, review: null } })
export const recordReview = (by: string, outcome: ReviewOutcome, comment: string) =>
  emit({ ...state, draft: { ...state.draft, submitted: outcome === 'confirmed', review: { by, at: new Date().toISOString(), outcome, comment } } })
// Issuing creates a new frozen version; earlier versions are never changed.
export function issuePack(by: string, data: PackData) {
  const reviewedBy = state.draft.review?.by ?? ''
  const version = state.packs.length + 1
  emit({ ...state, packs: [...state.packs, { version, issuedAt: new Date().toISOString(), issuedBy: by, reviewedBy, data: structuredClone(data) }] })
  return version
}
export const resetDecision = () => emit({ ...state, draft: EMPTY })
