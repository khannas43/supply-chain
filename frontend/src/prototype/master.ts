import { useSyncExternalStore } from 'react'
import {
  SUPPLIERS, SUPPLIER_BY_ID, setQualOverrides, setSiteOverrides,
  type AssetType, type Qualification, type SiteProfile, type Stage, type Supplier,
} from './data'

// Supplier Master: maintained identity, aliases, identifiers, registry link and qualification per product form,
// with a version history. It stores usable identities only; there is no golden-record merging.
export interface QualRecord { status: Qualification; evidence: string; confirmedBy: string; validFrom: string; enteredBy: string; enteredAt: string }
export interface VersionEntry { version: number; at: string; by: string; changes: string[] }
export interface Identity { legalName: string; aliases: string[]; lei: string; regNo: string; jurisdiction: string; duns: string; registryId: string }
export interface MasterRecord extends Identity {
  id: string
  forms?: string[]
  site?: Partial<SiteProfile>
  qualifications: Record<string, QualRecord>
  versions: VersionEntry[]
  created?: Supplier
}

export const ALL_FORMS = ['APT', 'WO3', 'FeW']
const ORIGINAL_FORMS: Record<string, string[]> = Object.fromEntries(SUPPLIERS.map((s) => [s.id, [...s.forms]]))
const SEED: Record<string, Partial<Identity>> = {
  A: { legalName: 'Ardenne Tungsten Refining GmbH', lei: 'REPRESENTATIVE00000A', regNo: 'FN 000001 a', jurisdiction: 'Austria' },
  B: { legalName: 'Bao Viet Tungsten Joint Stock Company', regNo: '0100000002', jurisdiction: 'Vietnam' },
  C: { legalName: 'Costa Alta Mining, S.A.', lei: 'REPRESENTATIVE00000C', regNo: '500000003', jurisdiction: 'Portugal', aliases: ['Costa Alta'] },
}
export const IDENTIFIER_FIELDS = ['lei', 'regNo', 'duns'] as const

export function defaultRecord(s: Supplier): MasterRecord {
  const i = SUPPLIERS.findIndex((x) => x.id === s.id) + 1
  return { id: s.id, legalName: '', aliases: [], lei: '', regNo: '', jurisdiction: '', duns: '', registryId: `C05-W-${String(i).padStart(4, '0')}`, ...SEED[s.id], qualifications: {}, versions: [] }
}

interface State { records: Record<string, MasterRecord>; version: number }
const KEY = 'proto.master.v1'
function load(): State {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null')
    if (v && v.records) return { records: v.records, version: 0 }
  } catch { /* defaults */ }
  return { records: {}, version: 0 }
}
let state = load()

function apply() {
  const qual: Record<string, Record<string, Qualification>> = {}
  const sites: Record<string, Partial<SiteProfile>> = {}
  for (const r of Object.values(state.records)) {
    if (r.created && !SUPPLIER_BY_ID[r.id]) { SUPPLIERS.push(r.created); SUPPLIER_BY_ID[r.id] = r.created }
    const s = SUPPLIER_BY_ID[r.id]
    if (!s) continue
    s.forms = r.forms ?? ORIGINAL_FORMS[r.id] ?? s.forms
    qual[r.id] = Object.fromEntries(Object.entries(r.qualifications).map(([f, q]) => [f, q.status]))
    if (r.site) sites[r.id] = r.site
  }
  setQualOverrides(qual)
  setSiteOverrides(sites)
}
apply()

const listeners = new Set<() => void>()
function emit(records: Record<string, MasterRecord>) {
  state = { records, version: state.version + 1 }
  apply()
  try { localStorage.setItem(KEY, JSON.stringify({ records })) } catch { /* ignore */ }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const useMaster = () => useSyncExternalStore(subscribe, () => state)

// Seeded suppliers start at version 1 as loaded; a created supplier's creation is version 1.
const nextVersion = (r: MasterRecord) => (r.versions[0]?.version ?? (r.created ? 0 : 1)) + 1
export const currentVersion = (r: MasterRecord) => r.versions[0]?.version ?? 1
export const recordOf = (id: string): MasterRecord => state.records[id] ?? defaultRecord(SUPPLIER_BY_ID[id])
const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// every name a supplier is known by, for matching quote files and registry candidates
export const aliasIndex = (): { id: string; alias: string }[] =>
  SUPPLIERS.flatMap((s) => { const r = recordOf(s.id); return [r.legalName, ...r.aliases].filter(Boolean).map((alias) => ({ id: s.id, alias })) })

export function nameCollision(name: string, exceptId?: string): string | null {
  const n = norm(name)
  if (!n) return null
  for (const s of SUPPLIERS) {
    if (s.id === exceptId) continue
    if (norm(s.name) === n) return s.name
    const r = recordOf(s.id)
    if (norm(r.legalName) === n || r.aliases.some((a) => norm(a) === n)) return s.name
  }
  return null
}

export const validateLei = (v: string) => v === '' || /^[A-Z0-9]{20}$/.test(v) ? null : 'A LEI has 20 letters and digits.'

const label: Record<keyof Identity, string> = { legalName: 'Legal name', aliases: 'Aliases', lei: 'LEI', regNo: 'Registration number', jurisdiction: 'Jurisdiction', duns: 'DUNS', registryId: 'Credibl registry record' }

export interface IdentityEdit extends Identity { forms: string[]; site: Partial<SiteProfile> }
export function saveSupplier(id: string, edit: IdentityEdit, by: string): string[] {
  const cur = recordOf(id)
  const s = SUPPLIER_BY_ID[id]
  const changes: string[] = []
  for (const k of Object.keys(label) as (keyof Identity)[]) {
    const a = k === 'aliases' ? cur.aliases.join('; ') : (cur[k] as string)
    const b = k === 'aliases' ? edit.aliases.join('; ') : (edit[k] as string)
    if (a !== b) changes.push(`${label[k]}: “${a || '–'}” → “${b || '–'}”`)
  }
  const oldForms = (cur.forms ?? s.forms).join(', '), newForms = edit.forms.join(', ')
  if (oldForms !== newForms) changes.push(`Product forms: ${oldForms || '–'} → ${newForms || '–'}`)
  const oldSite = JSON.stringify(cur.site ?? {}), newSite = JSON.stringify(edit.site)
  if (oldSite !== newSite) changes.push('Site details changed')
  if (!changes.length) return []
  const rec: MasterRecord = {
    ...cur, ...edit, id, forms: edit.forms, site: edit.site,
    versions: [{ version: nextVersion(cur), at: new Date().toISOString(), by, changes }, ...cur.versions],
  }
  emit({ ...state.records, [id]: rec })
  return changes
}

export function recordQualification(id: string, form: string, q: Omit<QualRecord, 'enteredAt'>) {
  const cur = recordOf(id)
  const prev = cur.qualifications[form]
  const entry: QualRecord = { ...q, enteredAt: new Date().toISOString() }
  const change = `Qualification ${form}: ${prev ? prev.status.replace('_', ' ') : 'not recorded'} → ${q.status.replace('_', ' ')} (confirmed by ${q.confirmedBy || 'n/a'}; evidence ${q.evidence || 'none'})`
  emit({ ...state.records, [id]: { ...cur, qualifications: { ...cur.qualifications, [form]: entry }, versions: [{ version: nextVersion(cur), at: entry.enteredAt, by: q.enteredBy, changes: [change] }, ...cur.versions] } })
}

export interface NewSupplier { name: string; legalName: string; country: string; assetType: AssetType; stage: Stage; forms: string[]; capacityT: number | null }
export function createSupplier(n: NewSupplier, by: string): string {
  const nums = SUPPLIERS.map((s) => Number(s.id.replace(/^S/, ''))).filter((x) => Number.isFinite(x))
  const id = `S${Math.max(14, ...nums) + 1}`
  const supplier: Supplier = {
    id, name: n.name.trim(), country: n.country.trim(), assetType: n.assetType, stage: n.stage, capacityT: n.capacityT, forms: n.forms,
    qualification: 'unknown', sanctions: 'review', rmi: n.assetType === 'Refinery' ? 'unknown' : 'na', quote: null, scores: {}, note: 'Added in the Supplier Master; no Credibl data yet and sanctions screening pending.',
  }
  const at = new Date().toISOString()
  emit({
    ...state.records,
    [id]: { id, legalName: n.legalName.trim(), aliases: [], lei: '', regNo: '', jurisdiction: n.country.trim(), duns: '', registryId: '', forms: n.forms, qualifications: {}, created: supplier,
      versions: [{ version: 1, at, by, changes: [`Created “${supplier.name}” (${n.country}, ${n.assetType.toLowerCase()}, ${n.stage.toLowerCase()})`] }] },
  })
  return id
}

// A registry candidate confirmed by an analyst; Credibl stores the confirmed mapping, IIP keeps a copy of the link.
export function linkRegistry(id: string, registryId: string, legalName: string, by: string, why: string) {
  const cur = recordOf(id)
  const changes = [`Credibl registry record: “${cur.registryId || '–'}” → “${registryId}” (${why})`]
  if (!cur.legalName && legalName) changes.push(`Legal name: “–” → “${legalName}”`)
  emit({ ...state.records, [id]: { ...cur, registryId, legalName: cur.legalName || legalName, versions: [{ version: nextVersion(cur), at: new Date().toISOString(), by, changes }, ...cur.versions] } })
}

// A confirmed link from a name seen in a file or registry candidate to a supplier; stored as an alias.
export function addAlias(id: string, alias: string, by: string, why: string) {
  const cur = recordOf(id)
  if (norm(cur.legalName) === norm(alias) || cur.aliases.some((a) => norm(a) === norm(alias)) || norm(SUPPLIER_BY_ID[id].name) === norm(alias)) return
  emit({ ...state.records, [id]: { ...cur, aliases: [...cur.aliases, alias], versions: [{ version: nextVersion(cur), at: new Date().toISOString(), by, changes: [`Alias added: “${alias}” (${why})`] }, ...cur.versions] } })
}
