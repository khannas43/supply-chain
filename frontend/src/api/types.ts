import type { Commodity, Mode, NetEdge, NetNode } from '../data/types'

export interface TraverseResult {
  focus: string
  direction: 'upstream' | 'downstream' | 'both'
  depth: number
  limit: number
  totalReachable: number
  truncated: boolean
  nodes: { node: NetNode; level: number }[]
  edges: NetEdge[]
  cycleEdgeIds: string[]
}

export type SourceState = 'fresh' | 'stale' | 'failing' | 'paused'

export interface SourceHealth {
  id: string
  name: string
  mode: Mode
  enabled: boolean
  commodities: Commodity[]
  lastAttempt: string | null
  lastUsable: string | null
  policyHours: number
  lastError: string | null
  state: SourceState
  hoursSinceUsable: number | null
}

export interface OverviewData {
  commodity: Commodity
  asOf: string
  activeAlerts: number
  alertsBySeverity: Record<string, number>
  assessedAlerts: number
  actions: { open: number; inProgress: number; review: number; done: number }
  lastAssessmentAt: string | null
  trend: { day: string; count: number }[]
  sources: SourceHealth[]
}

// ---- Assessment, options and actions ----
import type { ActionStatus, AssumptionStatus, ExposurePath, InputsSnapshot, ResponseOption, StatusEntry } from '../data/types'

export interface Person { id: string; name: string }

export interface AssumptionData {
  id: string
  alertId: string
  affectedSharePct: number
  basis: string
  proposedBy: Person
  proposedAt: string
  status: AssumptionStatus
  decidedBy?: Person | null
  decidedAt?: string | null
  decisionNote?: string | null
}

export interface AssessmentData {
  alertId: string
  version: number
  createdAt: string
  note: string
  calcVersion: string
  exposed: { value: number; unit: string; horizon: string }
  inputs: InputsSnapshot
  paths: ExposurePath[]
  missing: string[]
  referenceOption: ResponseOption
  assumption: AssumptionData | null
  calc: { coverDays: number | null; atRisk: number | null; gapDays: number | null; incrementalCost: number | null; reason: string | null }
  versions: { v: number; at: string; note: string }[]
}

export interface OptionRow {
  option: ResponseOption
  rank: number | null
  gapDays: number | null
  incrementalCost: number | null
  extraCoverDays: number | null
  quoteStatus: 'none' | 'valid' | 'expiring' | 'expired'
  daysToQuoteExpiry: number | null
  shortlisted: boolean
  reasons: string[]
}

export interface OptionsData {
  alertId: string
  assessmentVersion: number
  currency: string
  coverDays: number | null
  assumptionStatus: AssumptionStatus | 'none'
  unavailableReason: string | null
  ranked: OptionRow[]
  complementary: OptionRow[]
  ineligible: OptionRow[]
}

export interface ActionData {
  id: string
  alertId: string
  alertTitle: string
  commodity: Commodity
  optionId: string
  optionName: string
  ownerId: string
  ownerName: string
  targetDate: string
  rationale: string
  status: ActionStatus
  createdAt: string
  createdBy: string
  assessmentVersion: number
  currentAssessmentVersion: number
  assumptionStatus: string
  overdue: boolean
  reviewNeeded: boolean
  history: StatusEntry[]
  audit: { at: string; actor: string; event: string; ref: string; detail: string }[]
}

// ---- Pipeline, rules, reference data, imports, simulator ----

export interface RunData {
  id: string
  sourceId: string
  startedAt: string
  status: 'ok' | 'partial' | 'failed'
  accepted: number
  duplicate: number
  quarantined: number
  note: string
}

export interface QuarantineData {
  id: string
  sourceId: string
  sourceName: string
  runId: string
  receivedAt: string
  reason: string
  sourceRow: string
  objectKey: string
  field: string
  badValue: string
  status: 'quarantined' | 'replay_requested' | 'resolved'
  correction?: string | null
}

export interface DeadData {
  id: string
  sourceId: string
  sourceName: string
  receivedAt: string
  reason: string
  objectKey: string
  attempts: number
}

export interface QueueData {
  workerBacklog: number
  deadMessages: number
  oldestPendingSeconds: number | null
  kafka: 'connected' | 'not_connected'
  nifi: 'connected' | 'not_connected'
}

export interface ThresholdData { key: string; label: string; value: number; unit: string }
export interface RuleVersionData {
  v: string
  status: 'draft' | 'published' | 'superseded'
  thresholds: ThresholdData[]
  createdBy: string
  createdAt: string
  publishedBy?: string | null
  publishedAt?: string | null
}
export interface RuleData { id: string; name: string; commodity: Commodity; versions: RuleVersionData[] }

export interface ConversionData { id: string; from: string; to: string; factor: number; effectiveFrom: string; source: string }
export interface ReferenceData {
  countries: { code: string; name: string; aliases: string[] }[]
  forms: { commodity: Commodity; form: string; note: string }[]
  conversions: ConversionData[]
}

export interface DatasetData { id: string; label: string; required: string[]; sample: string; applied: boolean }
export interface ImportReport {
  dataset: string
  checksum: string
  headerErrors: string[]
  valid: number
  duplicates: number
  rejected: { row: number; reason: string; field: string; badValue: string }[]
  alreadyImportedAs?: string | null
}
export interface ImportData {
  id: string
  dataset: string
  version: number
  rows: number
  rejected: number
  checksum: string
  committedBy: string
  committedAt: string
  applied: boolean
}

export interface ScenarioData { id: string; name: string; commodity: Commodity; seed: number; events: { at: number; text: string }[] }
export interface SimState {
  status: 'idle' | 'running' | 'paused'
  scenarioId?: string | null
  runId?: string | null
  seed?: number | null
  offsetHours: number
  virtualNow: string
  emitted: number
  totalEvents: number
  log: { at: string; runId: string; text: string }[]
}
export type FailureKind = 'rate_limit' | 'timeout' | 'recover' | 'duplicate' | 'late' | 'malformed' | 'missing_field'

export interface PersonData { id: string; name: string; roles: string[] }
