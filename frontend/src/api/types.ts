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
