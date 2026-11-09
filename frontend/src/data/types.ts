export type Commodity = 'wheat' | 'tungsten'
export type Mode = 'live' | 'replay' | 'simulated'
export type Severity = 'low' | 'medium' | 'high' | 'critical'
export type Confidence = 'low' | 'medium' | 'high'
export type AssessmentStatus = 'unassessed' | 'partial' | 'complete' | 'awaiting_validation'
export type Disposition = 'new' | 'confirmed' | 'monitor' | 'dismissed'

export interface Evidence {
  source: string
  objectKey: string
  sha256: string
  publishedAt: string
  ingestedAt: string
}

export interface Alert {
  id: string
  commodity: Commodity
  title: string
  summary: string
  location: string
  severity: Severity
  confidence: Confidence
  observedAt: string
  mode: Mode
  scenarioRun?: string
  assessmentStatus: AssessmentStatus
  disposition: Disposition
  ruleVersion: string
  ruleInputs: string[]
  evidence: Evidence
  exposedNodeIds: string[]
  exposed?: { value: number; unit: string; horizon: string } | null
  daysOfCover?: number | null
}

export type NodeKind = 'origin' | 'supplier' | 'plant' | 'product'

export interface NetNode {
  id: string
  commodity: Commodity
  name: string
  kind: NodeKind
  tier?: string | null
  country: string
  site?: string | null
}

export interface NetEdge {
  id: string
  from: string // upstream
  to: string // downstream
  material: string
  source: string
  confidence: Confidence
  effectiveFrom: string
  uncertain?: boolean
  note?: string | null
}

export interface SourceStatus {
  id: string
  name: string
  mode: Mode
  lastUsable: string
  policyHours: number
  state: 'ok' | 'stale' | 'failing'
}

export interface ActionSummary {
  commodity: Commodity
  open: number
  inProgress: number
  review: number
  done: number
}

export interface Identity {
  id: string
  name: string
  role: import('../auth/roles').Role
}

export type PathClass = 'confirmed' | 'potential' | 'unknown'

export interface ExposurePath {
  nodes: string[]
  classification: PathClass
  basis: string
}

export interface InputsSnapshot {
  asOf: string
  usableStock: number
  stockUnit: string
  demandPerDay: number
  baselinePrice: number
  currency: string
  priceUnit: string
  notes: string[]
}

export interface AssessmentBase {
  alertId: string
  calcVersion: string
  paths: ExposurePath[]
  exposed: { value: number; unit: string; horizon: string }
  inputs: InputsSnapshot
  missing: string[]
  referenceOptionId: string
}

export type AssumptionStatus = 'proposed' | 'approved' | 'rejected' | 'superseded'

export interface Assumption {
  id: string
  alertId: string
  affectedSharePct: number
  basis: string
  proposedBy: { id: string; name: string }
  proposedAt: string
  status: AssumptionStatus
  decidedBy?: { id: string; name: string }
  decidedAt?: string
  decisionNote?: string
}

export interface VersionNote {
  v: number
  at: string
  note: string
}

export type OptionType = 'sourcing' | 'inventory' | 'logistics'
export type Qualification = 'qualified' | 'unknown' | 'expired'
export type SpecFit = 'meets' | 'partial' | 'unknown'

export interface ResponseOption {
  id: string
  alertId: string
  type: OptionType
  name: string
  qualification: Qualification
  specFit: SpecFit
  capacity: string
  unitPrice?: number | null
  quantityAvailable?: number | null
  leadTimeDays: number
  quoteValidUntil?: string | null
  note: string
}

export type ActionStatus = 'open' | 'in_progress' | 'review' | 'done'

export interface StatusEntry {
  at: string
  actor: string
  from: ActionStatus | null
  to: ActionStatus
  note: string
}

export interface ActionItem {
  id: string
  alertId: string
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
  assumptionStatus: AssumptionStatus | 'none'
  history: StatusEntry[]
}

export interface AuditEntry {
  at: string
  actor: string
  event: string
  ref: string
  detail: string
}
