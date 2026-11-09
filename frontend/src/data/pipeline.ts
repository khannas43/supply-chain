import type { Commodity, Mode } from './types'

// Demo data for the backend seed (npm run seed:export). The application reads everything from the API.

export interface SourceRow {
  id: string
  name: string
  mode: Mode
  commodities: Commodity[]
  enabled: boolean
  lastAttempt: string
  lastUsable: string
  policyHours: number
  lastError?: string
}

export interface RunRow {
  id: string
  sourceId: string
  startedAt: string
  status: 'ok' | 'partial' | 'failed'
  accepted: number
  duplicate: number
  quarantined: number
  note: string
}

export interface QuarantineRow {
  id: string
  sourceId: string
  runId: string
  receivedAt: string
  reason: string
  sourceRow: string
  objectKey: string
  field: string
  badValue: string
  status: 'quarantined' | 'replay_requested'
  correction?: string
}

export interface DeadRow {
  id: string
  sourceId: string
  receivedAt: string
  reason: string
  objectKey: string
  attempts: number
}

export const seedSources: SourceRow[] = [
  { id: 'src-policy', name: 'Policy feed (simulator)', mode: 'simulated', commodities: ['wheat', 'tungsten'], enabled: true, lastAttempt: '2026-11-09T08:30:00Z', lastUsable: '2026-11-08T14:20:00Z', policyHours: 48 },
  { id: 'src-logistics', name: 'Logistics feed (simulator)', mode: 'simulated', commodities: ['wheat'], enabled: true, lastAttempt: '2026-11-09T08:30:00Z', lastUsable: '2026-11-08T08:05:00Z', policyHours: 12 },
  { id: 'src-price', name: 'Price series (replay)', mode: 'replay', commodities: ['tungsten'], enabled: true, lastAttempt: '2026-11-09T08:30:00Z', lastUsable: '2026-11-08T16:30:00Z', policyHours: 24 },
  { id: 'src-import', name: 'Manual file imports', mode: 'simulated', commodities: ['wheat', 'tungsten'], enabled: true, lastAttempt: '2026-11-06T09:00:00Z', lastUsable: '2026-11-06T09:00:00Z', policyHours: 168 },
]

export const seedRuns: RunRow[] = [
  { id: 'RUN-0112', sourceId: 'src-policy', startedAt: '2026-11-08T14:20:00Z', status: 'ok', accepted: 3, duplicate: 0, quarantined: 0, note: '' },
  { id: 'RUN-0113', sourceId: 'src-logistics', startedAt: '2026-11-08T08:05:00Z', status: 'partial', accepted: 4, duplicate: 1, quarantined: 1, note: 'One row rejected: delay_days not numeric' },
  { id: 'RUN-0114', sourceId: 'src-price', startedAt: '2026-11-08T16:30:00Z', status: 'partial', accepted: 29, duplicate: 0, quarantined: 1, note: 'One row missing currency' },
  { id: 'RUN-0115', sourceId: 'src-logistics', startedAt: '2026-11-09T08:30:00Z', status: 'failed', accepted: 0, duplicate: 0, quarantined: 0, note: 'HTTP 429, retried after backoff; no usable data yet' },
  { id: 'RUN-0116', sourceId: 'src-import', startedAt: '2026-11-06T09:00:00Z', status: 'ok', accepted: 14, duplicate: 0, quarantined: 0, note: 'Supplier network file v1' },
]

export const seedQuarantine: QuarantineRow[] = [
  { id: 'Q-0031', sourceId: 'src-logistics', runId: 'RUN-0113', receivedAt: '2026-11-08T08:05:00Z', reason: 'delay_days is not a number', sourceRow: 'row 3 of obs-000130.json', objectKey: 'evidence/sim/wheat-policy/run-0003/obs-000130.json', field: 'delay_days', badValue: 'three', status: 'quarantined' },
  { id: 'Q-0032', sourceId: 'src-price', runId: 'RUN-0114', receivedAt: '2026-11-08T16:30:00Z', reason: 'Missing required field: currency', sourceRow: 'row 18 of obs-000409.csv', objectKey: 'evidence/replay/tungsten-price/obs-000409.csv', field: 'currency', badValue: '', status: 'quarantined' },
]

export const seedDead: DeadRow[] = [
  { id: 'DL-0004', sourceId: 'src-policy', receivedAt: '2026-11-05T11:12:00Z', reason: 'Schema version 9 not supported (mapping v1 only)', objectKey: 'evidence/sim/wheat-policy/run-0002/obs-000099.json', attempts: 3 },
]

// ---- Risk rules ----

export interface Threshold { key: string; label: string; value: number; unit: string }
export interface RuleVersion {
  v: string
  status: 'draft' | 'published' | 'superseded'
  thresholds: Threshold[]
  createdBy: string
  createdAt: string
  publishedBy?: string
  publishedAt?: string
}
export interface Rule { id: string; name: string; commodity: Commodity; versions: RuleVersion[] }

const t = (key: string, label: string, value: number, unit: string): Threshold => ({ key, label, value, unit })

export const seedRules: Rule[] = [
  {
    id: 'R-W-EXP', name: 'wheat-export-policy', commodity: 'wheat',
    versions: [
      { v: '1.1', status: 'superseded', thresholds: [t('conf', 'Confidence floor to raise an alert', 60, '%'), t('sev', 'Severity score (1 low to 4 critical)', 2, 'score'), t('stale', 'Stale after', 24, 'hours')], createdBy: 'Risk Analyst A', createdAt: '2026-10-20T10:00:00Z', publishedBy: 'Risk Analyst A', publishedAt: '2026-10-20T10:30:00Z' },
      { v: '1.2', status: 'published', thresholds: [t('conf', 'Confidence floor to raise an alert', 50, '%'), t('sev', 'Severity score (1 low to 4 critical)', 3, 'score'), t('stale', 'Stale after', 48, 'hours')], createdBy: 'Risk Analyst A', createdAt: '2026-10-28T10:00:00Z', publishedBy: 'Risk Analyst B', publishedAt: '2026-10-28T11:00:00Z' },
    ],
  },
  { id: 'R-W-LOG', name: 'wheat-logistics', commodity: 'wheat', versions: [{ v: '1.0', status: 'published', thresholds: [t('delay', 'Port delay threshold', 3, 'days'), t('sev', 'Severity score (1 low to 4 critical)', 2, 'score'), t('stale', 'Stale after', 12, 'hours')], createdBy: 'Risk Analyst A', createdAt: '2026-10-20T10:00:00Z', publishedBy: 'Risk Analyst A', publishedAt: '2026-10-20T10:30:00Z' }] },
  { id: 'R-T-EXP', name: 'tungsten-export-policy', commodity: 'tungsten', versions: [{ v: '1.0', status: 'published', thresholds: [t('conf', 'Confidence floor to raise an alert', 60, '%'), t('sev', 'Severity score (1 low to 4 critical)', 4, 'score'), t('stale', 'Stale after', 48, 'hours')], createdBy: 'Risk Analyst B', createdAt: '2026-10-21T10:00:00Z', publishedBy: 'Risk Analyst B', publishedAt: '2026-10-21T10:30:00Z' }] },
  { id: 'R-T-PRC', name: 'tungsten-price', commodity: 'tungsten', versions: [{ v: '1.0', status: 'published', thresholds: [t('chg', '30-day price change', 15, '%'), t('sev', 'Severity score (1 low to 4 critical)', 1, 'score'), t('stale', 'Stale after', 24, 'hours')], createdBy: 'Risk Analyst B', createdAt: '2026-10-21T10:00:00Z', publishedBy: 'Risk Analyst A', publishedAt: '2026-10-21T10:30:00Z' }] },
]

// ---- Reference data ----

export interface Conversion { id: string; from: string; to: string; factor: number; effectiveFrom: string; source: string }
export const seedConversions: Conversion[] = [
  { id: 'CV-1', from: 't', to: 'kg', factor: 1000, effectiveFrom: '2024-01-01', source: 'SI' },
  { id: 'CV-2', from: 'bushel (wheat, 60 lb)', to: 't', factor: 0.0272155, effectiveFrom: '2024-01-01', source: 'Approved unit table v2' },
  { id: 'CV-3', from: 'USD', to: 'EUR', factor: 0.92, effectiveFrom: '2026-11-01', source: 'Approved rate table v3 (synthetic)' },
]

export const countries = [
  { code: 'CTA', name: 'Country A', aliases: ['A', 'Country-A', 'CTRY_A'] },
  { code: 'CTB', name: 'Country B', aliases: ['B', 'Country-B'] },
  { code: 'CTT', name: 'Country T', aliases: ['T', 'Country-T', 'CTRY_T'] },
  { code: 'CTV', name: 'Country V', aliases: ['V', 'Country-V'] },
]

export const forms = [
  { commodity: 'wheat', form: 'Milling grade', note: 'Protein and moisture spec per contract' },
  { commodity: 'wheat', form: 'Feed grade', note: 'Not interchangeable with milling grade' },
  { commodity: 'tungsten', form: 'Concentrate (65% WO3)', note: 'Basis for WO3-equivalent conversion' },
  { commodity: 'tungsten', form: 'APT', note: 'Ammonium paratungstate' },
  { commodity: 'tungsten', form: 'Carbide powder', note: 'Carbide-grade, qualified suppliers only' },
]
