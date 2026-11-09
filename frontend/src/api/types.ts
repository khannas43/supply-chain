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
