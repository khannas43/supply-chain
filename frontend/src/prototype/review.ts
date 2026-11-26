import { useSyncExternalStore } from 'react'
import { SUPPLIER_BY_ID } from './data'
import { addAlias, linkRegistry } from './master'
import { MAPPING_VERSION, commitQuotes, validateRow, type RowResult } from './quotes'

// Data review queue: rows and matches that cannot enter the scores until an analyst corrects or confirms them.
// Corrections create attributable events and replay through the same validation; they never rewrite an issued pack.
export type ReviewCode = 'AMBIGUOUS_SUPPLIER' | 'UNKNOWN_SUPPLIER' | 'UNRECOGNISED_CURRENCY' | 'INVALID_VALUE' | 'CREDIBL_MATCH'
export interface Candidate { id?: string; label: string; confidence?: number; registryId?: string }
export interface ReviewEvent { at: string; by: string; action: string; detail: string }
export interface ReviewItem {
  id: string
  key: string
  kind: 'quote_row' | 'supplier_match'
  code: ReviewCode
  reasons: string[]
  source: string
  file?: string
  line?: number
  raw: Record<string, string>
  corrected?: Record<string, string>
  subject?: string
  candidates: Candidate[]
  severity: 'high' | 'medium' | 'low'
  owner: string
  state: 'open' | 'resolved' | 'dismissed'
  createdAt: string
  events: ReviewEvent[]
}

export const CODE_LABEL: Record<ReviewCode, string> = {
  AMBIGUOUS_SUPPLIER: 'Ambiguous supplier', UNKNOWN_SUPPLIER: 'Unknown supplier', UNRECOGNISED_CURRENCY: 'Unrecognised currency', INVALID_VALUE: 'Invalid value', CREDIBL_MATCH: 'Registry match to confirm',
}

const codeOf = (r: RowResult): ReviewCode => {
  const m = r.messages.join(' ')
  return m.includes('Ambiguous') ? 'AMBIGUOUS_SUPPLIER' : m.includes('not in the registry') ? 'UNKNOWN_SUPPLIER' : m.includes('Currency') ? 'UNRECOGNISED_CURRENCY' : 'INVALID_VALUE'
}
const SEVERITY: Record<ReviewCode, ReviewItem['severity']> = { AMBIGUOUS_SUPPLIER: 'high', UNKNOWN_SUPPLIER: 'medium', UNRECOGNISED_CURRENCY: 'medium', INVALID_VALUE: 'low', CREDIBL_MATCH: 'medium' }

interface State { items: ReviewItem[]; seeded: boolean }
const KEY = 'proto.review.v1'
const at0 = '2026-11-25T09:00:00.000Z'
const seed = (): ReviewItem[] => [
  { id: 'R-seed-F', key: 'credibl#F', kind: 'supplier_match', code: 'CREDIBL_MATCH', reasons: ['Credibl returned candidates below the auto-accept confidence; the match must be confirmed before any score uses it.'],
    source: 'Credibl supplier matching (C-09), stand-in', raw: { supplier: 'Fergana Minerals', country: 'Kazakhstan', lei: '(none held)', registration: '(none held)' }, subject: 'F',
    candidates: [{ label: 'Fergana Minerals JSC', confidence: 0.62, registryId: 'C05-W-9001' }, { label: 'Fergana Mining LLC', confidence: 0.58, registryId: 'C05-W-9002' }, { label: 'Ferghana Metals Ltd', confidence: 0.31, registryId: 'C05-W-9003' }],
    severity: 'medium', owner: 'Delivery-team analyst', state: 'open', createdAt: at0, events: [{ at: at0, by: 'Credibl stand-in', action: 'Raised', detail: 'Three candidates; best confidence 0.62' }] },
  { id: 'R-seed-K', key: 'credibl#K', kind: 'supplier_match', code: 'CREDIBL_MATCH', reasons: ['Early-stage project with no identifiers; one low-confidence candidate.'],
    source: 'Credibl supplier matching (C-09), stand-in', raw: { supplier: 'Kluane Exploration', country: 'Canada', lei: '(none held)', registration: '(none held)' }, subject: 'K',
    candidates: [{ label: 'Kluane Exploration Corp.', confidence: 0.55, registryId: 'C05-W-9010' }],
    severity: 'low', owner: 'Delivery-team analyst', state: 'open', createdAt: at0, events: [{ at: at0, by: 'Credibl stand-in', action: 'Raised', detail: 'One candidate; confidence 0.55' }] },
]

function load(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (v && Array.isArray(v.items)) return v
  } catch { /* defaults */ }
  return { items: seed(), seeded: true }
}
let state = load()
const listeners = new Set<() => void>()
const emit = (items: ReviewItem[]) => {
  state = { items, seeded: true }
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useReview = () => useSyncExternalStore(subscribe, () => state)
const patch = (id: string, fn: (i: ReviewItem) => ReviewItem) => emit(state.items.map((i) => (i.id === id ? fn(i) : i)))
const ev = (by: string, action: string, detail: string): ReviewEvent => ({ at: new Date().toISOString(), by, action, detail })

// Rejected quote rows go to the queue once: the same file, line and supplier is never queued twice.
export function queueRejections(rows: RowResult[], file: string, by: string): number {
  const fresh = rows.filter((r) => r.status === 'rejected').filter((r) => !state.items.some((i) => i.key === `${file}#${r.line}#${r.raw.supplier}`))
  if (!fresh.length) return 0
  const items: ReviewItem[] = fresh.map((r) => {
    const code = codeOf(r)
    return {
      id: `R-${Date.now().toString(36)}-${r.line}`, key: `${file}#${r.line}#${r.raw.supplier}`, kind: 'quote_row', code, reasons: r.messages, source: `${file}, line ${r.line}`, file, line: r.line, raw: r.raw,
      candidates: (r.candidates ?? []).map((s) => ({ id: s.id, label: s.name })), severity: SEVERITY[code], owner: 'Delivery-team analyst', state: 'open', createdAt: new Date().toISOString(),
      events: [{ at: new Date().toISOString(), by, action: 'Raised', detail: r.messages[0] ?? 'Rejected on load' }],
    }
  })
  emit([...items, ...state.items])
  return items.length
}

function replay(item: ReviewItem, raw: Record<string, string>, by: string, how: string): { ok: boolean; messages: string[] } {
  const res = validateRow(raw, item.line ?? 0)
  if (res.status === 'rejected') {
    patch(item.id, (i) => ({ ...i, reasons: res.messages, events: [...i.events, ev(by, 'Replay failed', `${how}; still rejected: ${res.messages.join(' ')}`)] }))
    return { ok: false, messages: res.messages }
  }
  commitQuotes([res], item.file ?? 'review', by)
  patch(item.id, (i) => ({ ...i, state: 'resolved', corrected: raw, reasons: res.messages, events: [...i.events, ev(by, 'Replayed', `${how}; accepted under ${MAPPING_VERSION} and the quote loaded`)] }))
  return { ok: true, messages: res.messages }
}

// Confirm which supplier a name in a file belongs to: the alias is kept in the Supplier Master, then the row is replayed.
export function resolveWithLink(itemId: string, supplierId: string, by: string) {
  const item = state.items.find((i) => i.id === itemId)
  if (!item || item.kind !== 'quote_row') return { ok: false, messages: ['Not a quote row.'] }
  addAlias(supplierId, item.raw.supplier, by, `confirmed from ${item.source}`)
  return replay(item, item.raw, by, `Linked “${item.raw.supplier}” to ${SUPPLIER_BY_ID[supplierId].name}`)
}

export function correctAndReplay(itemId: string, corrected: Record<string, string>, by: string) {
  const item = state.items.find((i) => i.id === itemId)
  if (!item) return { ok: false, messages: ['Item not found.'] }
  const diffs = Object.keys(corrected).filter((k) => corrected[k] !== item.raw[k]).map((k) => `${k}: “${item.raw[k]}” → “${corrected[k]}”`)
  return replay(item, corrected, by, diffs.length ? `Corrected ${diffs.join(', ')}` : 'Replayed without changes')
}

export function confirmMatch(itemId: string, index: number, by: string) {
  const item = state.items.find((i) => i.id === itemId)
  const c = item?.candidates[index]
  if (!item || !c || !item.subject) return
  linkRegistry(item.subject, c.registryId ?? '', c.label, by, `analyst confirmed candidate at confidence ${c.confidence ?? 'n/a'}`)
  patch(itemId, (i) => ({ ...i, state: 'resolved', events: [...i.events, ev(by, 'Match confirmed', `${c.label} (${c.registryId}); the confirmed mapping is stored in the Supplier Master and returned to Credibl`)] }))
}

export const dismiss = (itemId: string, reason: string, by: string) =>
  patch(itemId, (i) => ({ ...i, state: 'dismissed', events: [...i.events, ev(by, 'Dismissed', reason)] }))
export const reopen = (itemId: string, by: string) =>
  patch(itemId, (i) => ({ ...i, state: 'open', events: [...i.events, ev(by, 'Reopened', 'Returned to the queue')] }))
