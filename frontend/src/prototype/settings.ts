import { useSyncExternalStore } from 'react'
import { CONFIG } from './data'

// Settings the delivery team maintains without a code change, with every change logged.
export const LIMIT_MIN = 2
export const LIMIT_MAX = 25 // performance is verified up to this many suppliers

export interface ChangeLogEntry { at: string; by: string; setting: string; from: string; to: string }
interface Settings { comparisonLimit: number; log: ChangeLogEntry[] }

const KEY = 'proto.settings.v1'
const load = (): Settings => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (v && typeof v.comparisonLimit === 'number' && Array.isArray(v.log)) return v
  } catch { /* storage unavailable: defaults */ }
  return { comparisonLimit: CONFIG.comparisonLimit, log: [] }
}

let state = load()
const listeners = new Set<() => void>()
const emit = () => {
  try { localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }

export const getLimit = () => state.comparisonLimit

export function validateLimit(n: number): string | null {
  if (!Number.isInteger(n)) return 'Enter a whole number.'
  if (n < LIMIT_MIN) return `The limit must be at least ${LIMIT_MIN}: a comparison needs two suppliers.`
  if (n > LIMIT_MAX) return `The limit cannot exceed ${LIMIT_MAX}, the size performance is verified for.`
  return null
}

export function setComparisonLimit(n: number, by: string): string | null {
  const err = validateLimit(n)
  if (err) return err
  if (n === state.comparisonLimit) return null
  const entry: ChangeLogEntry = { at: new Date().toISOString(), by, setting: 'Comparison limit', from: String(state.comparisonLimit), to: String(n) }
  state = { comparisonLimit: n, log: [entry, ...state.log].slice(0, 200) }
  emit()
  return null
}

export const useSettings = () => useSyncExternalStore(subscribe, () => state)
