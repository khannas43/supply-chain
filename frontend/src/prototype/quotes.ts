import { useSyncExternalStore } from 'react'
import { SUPPLIERS, setQuoteOverrides, type Quote, type Supplier } from './data'
import { aliasIndex } from './master'

// Client quotes loaded from CSV. Original rows are validated and mapped (version below); accepted rows replace the
// supplier's quote, rejected rows stay out of the scores and landed cost until corrected and re-loaded.
export const MAPPING_VERSION = 'quote-template v1'
export const FIELDS = [
  { column: 'supplier', field: 'Supplier (name or identifier)', required: true },
  { column: 'price_usd_per_t', field: 'Unit price', required: true },
  { column: 'currency', field: 'Currency (USD)', required: true },
  { column: 'unit', field: 'Price unit (t or kg)', required: true },
  { column: 'freight_usd', field: 'Freight, insurance and handling (USD)', required: false },
  { column: 'tariff_pct', field: 'Duty or tariff (%)', required: false },
  { column: 'lead_weeks', field: 'Lead time (weeks)', required: true },
  { column: 'quote_date', field: 'Quote date (YYYY-MM-DD)', required: true },
] as const

export const TEMPLATE_CSV = FIELDS.map((f) => f.column).join(',') + '\n'

export const SAMPLE_CSV = `supplier,price_usd_per_t,currency,unit,freight_usd,tariff_pct,lead_weeks,quote_date
Ardenne Tungsten Refining,40000,USD,t,60000,0,8,2026-11-20
Bao Viet Tungsten,38000,USD,t,120000,5,10,2026-11-20
Costa Alta Mining,41000,USD,t,45000,0,6,2026-11-20
Lee & Han Materials,42500,USD,t,50000,0,7,2026-11-20
Huye Highlands Mining,39.5,USD,kg,95000,,12,2026-11-18
Illimani Resources,36000,EUR,t,40000,0,9,2026-11-19
Jackson Ridge,44000,USD,t,70000,0,14,2026-11-20
Unknown Metals Ltd,40000,USD,t,50000,0,8,2026-11-20
Fergana Minerals,41500,USD,t,,0,11,2025-06-01
`

export type RowStatus = 'accepted' | 'warning' | 'rejected'
export interface RowResult {
  line: number
  raw: Record<string, string>
  status: RowStatus
  supplier?: Supplier
  quote?: Quote
  candidates?: Supplier[]
  messages: string[]
}
export interface ParseResult { columns: { column: string; found: boolean; required: boolean; field: string }[]; rows: RowResult[]; fatal?: string }

function splitCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); cell = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cell += c
  }
  row.push(cell)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function matchSupplier(input: string): { supplier?: Supplier; ambiguous?: Supplier[] } {
  const n = norm(input)
  if (!n) return {}
  const exact = SUPPLIERS.find((s) => s.id.toLowerCase() === n || norm(s.name) === n)
  if (exact) return { supplier: exact }
  const byAlias = aliasIndex().find((x) => norm(x.alias) === n)
  if (byAlias) return { supplier: SUPPLIERS.find((s) => s.id === byAlias.id) }
  const first = n.split(' ')[0]
  const cands = SUPPLIERS.filter((s) => norm(s.name).startsWith(n) || n.startsWith(norm(s.name)) || (first.length > 3 && norm(s.name).split(' ')[0] === first))
  return cands.length ? { ambiguous: cands } : {}
}

const today = new Date('2026-11-26T00:00:00Z')

// Validate one row against the quote template. Used for the first load and again when an analyst corrects a row (replay).
export function validateRow(raw: Record<string, string>, line: number): RowResult {
    const res: RowResult = { line, raw, status: 'accepted', messages: [] }
    const reject = (m: string) => { res.status = 'rejected'; res.messages.push(m) }
    const warn = (m: string) => { if (res.status === 'accepted') res.status = 'warning'; res.messages.push(m) }

    const m = matchSupplier(raw.supplier)
    if (m.supplier) res.supplier = m.supplier
    else if (m.ambiguous) { res.candidates = m.ambiguous; reject(`Ambiguous supplier match (${m.ambiguous.map((s) => s.name).join(' or ')}); an analyst must confirm it before the quote counts.`) }
    else reject(`Supplier “${raw.supplier}” is not in the registry or Supplier Master.`)

    let price = Number(raw.price_usd_per_t)
    if (raw.price_usd_per_t === '' || !Number.isFinite(price) || price <= 0) reject('Price is missing or not a positive number.')
    const unit = raw.unit.toLowerCase()
    if (['t', 'tonne', 'tonnes', 'mt'].includes(unit)) { /* per tonne already */ }
    else if (unit === 'kg') { price *= 1000; warn('Price converted from per kg to per tonne (×1000); original kept.') }
    else reject(`Unit “${raw.unit}” is not recognised (use t or kg).`)
    if (raw.currency.toUpperCase() !== 'USD') reject(`Currency ${raw.currency || '(blank)'} needs an approved exchange rate and date; no rate owner is named yet.`)

    const lead = Number(raw.lead_weeks)
    if (raw.lead_weeks === '' || !Number.isFinite(lead) || lead <= 0) reject('Lead time is missing or not a positive number of weeks.')

    const date = new Date(`${raw.quote_date}T00:00:00Z`)
    let age = 0
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.quote_date) || Number.isNaN(date.getTime())) reject('Quote date is missing or not in YYYY-MM-DD form.')
    else {
      age = Math.round((today.getTime() - date.getTime()) / 86400000)
      if (age < 0) reject('Quote date is in the future.')
      else if (age > 90) warn(`Quote is ${age} days old; check it is still valid.`)
    }

    const missingFields: ('freight' | 'tariff')[] = []
    let freight = 0, tariff = 0
    if (raw.freight_usd === '') { missingFields.push('freight'); warn('Freight, insurance and handling not supplied; counted as zero and flagged.') }
    else { freight = Number(raw.freight_usd); if (!Number.isFinite(freight) || freight < 0) reject('Freight is not a valid amount.') }
    if (raw.tariff_pct === '') { missingFields.push('tariff'); warn('Tariff not supplied; counted as zero and flagged.') }
    else { tariff = Number(raw.tariff_pct); if (!Number.isFinite(tariff) || tariff < 0 || tariff > 100) reject('Tariff must be between 0 and 100 per cent.') }

    if (res.status !== 'rejected' && res.supplier) {
      res.quote = { priceUsdPerT: price, freightUsd: freight, tariffPct: tariff, leadWeeks: lead, quotedOn: raw.quote_date, ...(missingFields.length ? { missing: missingFields } : {}) }
    }
    return res
}

export function parseQuotes(text: string): ParseResult {
  const table = splitCsv(text)
  if (table.length < 2) return { columns: [], rows: [], fatal: 'The file has no data rows.' }
  const header = table[0].map((h) => h.trim().toLowerCase())
  const columns = FIELDS.map((f) => ({ column: f.column, found: header.includes(f.column), required: f.required, field: f.field }))
  const missing = columns.filter((c) => c.required && !c.found)
  if (missing.length) return { columns, rows: [], fatal: `Required column${missing.length > 1 ? 's' : ''} missing: ${missing.map((m) => m.column).join(', ')}. Use the template.` }

  const rows: RowResult[] = table.slice(1).map((cells, i) => validateRow(Object.fromEntries(header.map((h, k) => [h, (cells[k] ?? '').trim()])), i + 2))
  return { columns, rows }
}

// ---- store ----
export interface LoadLogEntry { at: string; by: string; file: string; accepted: number; rejected: number; note?: string }
export interface QuoteMeta { file: string; loadedAt: string; by: string }
interface State { quotes: Record<string, Quote | null>; meta: Record<string, QuoteMeta>; log: LoadLogEntry[]; version: number }

const KEY = 'proto.quotes.v1'
function load(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (v && v.quotes && v.meta && Array.isArray(v.log)) return { ...v, version: 0 }
  } catch { /* defaults */ }
  return { quotes: {}, meta: {}, log: [], version: 0 }
}
let state = load()
setQuoteOverrides(state.quotes)
const listeners = new Set<() => void>()
const emit = (next: State) => {
  state = { ...next, version: state.version + 1 }
  setQuoteOverrides(state.quotes)
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useQuotes = () => useSyncExternalStore(subscribe, () => state)

// Re-loading a file replaces the supplier's quote rather than adding a second one, so a replay creates no duplicates.
export function commitQuotes(rows: RowResult[], file: string, by: string) {
  const ok = rows.filter((r) => r.supplier && r.quote && r.status !== 'rejected')
  const at = new Date().toISOString()
  const quotes = { ...state.quotes }
  const meta = { ...state.meta }
  for (const r of ok) { quotes[r.supplier!.id] = r.quote!; meta[r.supplier!.id] = { file, loadedAt: at, by } }
  emit({ ...state, quotes, meta, log: [{ at, by, file, accepted: ok.length, rejected: rows.length - ok.length }, ...state.log].slice(0, 100) })
  return ok.length
}
export function removeQuote(id: string, by: string) {
  const at = new Date().toISOString()
  const meta = { ...state.meta }; delete meta[id]
  emit({ ...state, quotes: { ...state.quotes, [id]: null }, meta, log: [{ at, by, file: '–', accepted: 0, rejected: 0, note: `Removed the quote for ${id}; price falls back to the indicative reference` }, ...state.log].slice(0, 100) })
}
export function resetQuotes(by: string) {
  emit({ quotes: {}, meta: {}, log: [{ at: new Date().toISOString(), by, file: '–', accepted: 0, rejected: 0, note: 'Reset to the preloaded representative sample' }, ...state.log].slice(0, 100), version: state.version })
}
