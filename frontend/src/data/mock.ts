import type { ActionSummary, Alert, Commodity, NetEdge, NetNode, SourceStatus } from './types'

// All data below is synthetic and labelled simulated. Country and supplier names are fictional.
// The wheat figures follow the worked example in docs/data-to-dashboard-workflow.md section 6.

export const NOW = '2026-11-09T09:00:00Z'

export const alerts: Alert[] = [
  {
    id: 'AL-W-001',
    commodity: 'wheat',
    title: 'Export restriction announced, Country A',
    summary:
      'Policy announcement restricting wheat exports from Country A. The announcement alone does not quantify lost supply.',
    location: 'Country A',
    severity: 'high',
    confidence: 'medium',
    observedAt: '2026-11-07T14:20:00Z',
    mode: 'simulated',
    scenarioRun: 'wheat-policy / run-0003',
    assessmentStatus: 'partial',
    disposition: 'new',
    ruleVersion: 'wheat-export-policy v1.2',
    ruleInputs: ['policy_type = export_restriction', 'country = A', 'commodity = wheat'],
    evidence: {
      source: 'Simulated policy feed',
      objectKey: 'evidence/sim/wheat-policy/run-0003/obs-000124.json',
      sha256: '9f2c41b7a0e3d58c1f6a77b2e0c4d93a5b18e6f0a2c7d4e91b3f5a6c8d0e2f41',
      publishedAt: '2026-11-07T13:55:00Z',
      ingestedAt: '2026-11-07T14:20:00Z',
    },
    exposedNodeIds: ['w-supx', 'w-milly', 'w-plantz', 'w-prodp'],
    exposed: { value: 100, unit: 't', horizon: '30 days' },
    daysOfCover: 6,
  },
  {
    id: 'AL-W-002',
    commodity: 'wheat',
    title: 'Port congestion, Country B corridor',
    summary: 'Logistics delay reported on the main grain export corridor. Impact on contracted volume unknown.',
    location: 'Country B',
    severity: 'medium',
    confidence: 'low',
    observedAt: '2026-11-08T08:05:00Z',
    mode: 'simulated',
    scenarioRun: 'wheat-policy / run-0003',
    assessmentStatus: 'unassessed',
    disposition: 'new',
    ruleVersion: 'wheat-logistics v1.0',
    ruleInputs: ['event_type = port_delay', 'country = B', 'delay_days >= 3'],
    evidence: {
      source: 'Simulated logistics feed',
      objectKey: 'evidence/sim/wheat-policy/run-0003/obs-000131.json',
      sha256: '4be07d1c93a5f6280d7e1b4c6a9f3e50c2d8b7a14f6e0925c3d1a8b6f7e40c19',
      publishedAt: '2026-11-08T07:40:00Z',
      ingestedAt: '2026-11-08T08:05:00Z',
    },
    exposedNodeIds: ['w-supw'],
  },
  {
    id: 'AL-T-001',
    commodity: 'tungsten',
    title: 'Export licence tightening, Country T',
    summary: 'Simulated export-policy event affecting tungsten concentrate. Affected share not yet approved.',
    location: 'Country T',
    severity: 'critical',
    confidence: 'high',
    observedAt: '2026-11-06T10:10:00Z',
    mode: 'simulated',
    scenarioRun: 'tungsten-export / run-0001',
    assessmentStatus: 'awaiting_validation',
    disposition: 'confirmed',
    ruleVersion: 'tungsten-export-policy v1.0',
    ruleInputs: ['policy_type = export_licence', 'country = T', 'material = tungsten concentrate'],
    evidence: {
      source: 'Simulated policy feed',
      objectKey: 'evidence/sim/tungsten-export/run-0001/obs-000022.json',
      sha256: 'c81d5a30e7f294b6a1d3c8e05f72b94d6a0e1c3f8b57d2a49e6c0f1b3d85a7e2',
      publishedAt: '2026-11-06T09:50:00Z',
      ingestedAt: '2026-11-06T10:10:00Z',
    },
    exposedNodeIds: ['t-minem', 't-conc', 't-carbide', 't-plantk', 't-prodr'],
    exposed: { value: 18, unit: 't WO3 eq.', horizon: '90 days' },
  },
  {
    id: 'AL-T-002',
    commodity: 'tungsten',
    title: 'Concentrate price spike',
    summary: 'Price movement above threshold. Price signals do not establish supplier disruption.',
    location: 'Global',
    severity: 'low',
    confidence: 'medium',
    observedAt: '2026-11-08T16:30:00Z',
    mode: 'replay',
    scenarioRun: 'tungsten-export / replay-0002',
    assessmentStatus: 'unassessed',
    disposition: 'monitor',
    ruleVersion: 'tungsten-price v1.0',
    ruleInputs: ['price_change_30d > 15%'],
    evidence: {
      source: 'Replayed price series',
      objectKey: 'evidence/replay/tungsten-price/obs-000410.csv',
      sha256: '1a7e5c0d92b4f8365e1c7a0d49f2b6e83c5a1d70f4e9b2c6a83d1e5f07b94c2a',
      publishedAt: '2026-11-08T16:00:00Z',
      ingestedAt: '2026-11-08T16:30:00Z',
    },
    exposedNodeIds: [],
  },
]

export const nodes: NetNode[] = [
  // Wheat
  { id: 'w-supx', commodity: 'wheat', name: 'Supplier X', kind: 'origin', tier: 'Tier 3', country: 'Country A', site: 'Farm cooperative X' },
  { id: 'w-supw', commodity: 'wheat', name: 'Supplier W', kind: 'origin', tier: 'Tier 3', country: 'Country B', site: 'Port elevator W' },
  { id: 'w-traderq', commodity: 'wheat', name: 'Trader Q', kind: 'supplier', tier: 'Tier 2', country: 'Country C' },
  { id: 'w-milly', commodity: 'wheat', name: 'Mill Y', kind: 'supplier', tier: 'Tier 1', country: 'Country D', site: 'Mill Y main' },
  { id: 'w-plantz', commodity: 'wheat', name: 'Plant Z', kind: 'plant', country: 'Country D' },
  { id: 'w-prodp', commodity: 'wheat', name: 'Product P (flour)', kind: 'product', country: 'Country D' },
  // Tungsten
  { id: 't-minem', commodity: 'tungsten', name: 'Mine M', kind: 'origin', tier: 'Tier 4', country: 'Country T' },
  { id: 't-minen', commodity: 'tungsten', name: 'Mine N', kind: 'origin', tier: 'Tier 4', country: 'Country U' },
  { id: 't-conc', commodity: 'tungsten', name: 'Concentrator C', kind: 'supplier', tier: 'Tier 3', country: 'Country T' },
  { id: 't-apt', commodity: 'tungsten', name: 'APT Refiner R', kind: 'supplier', tier: 'Tier 2', country: 'Country V' },
  { id: 't-carbide', commodity: 'tungsten', name: 'Carbide Maker K', kind: 'supplier', tier: 'Tier 1', country: 'Country D' },
  { id: 't-plantk', commodity: 'tungsten', name: 'Plant K', kind: 'plant', country: 'Country D' },
  { id: 't-prodr', commodity: 'tungsten', name: 'Product R (cutting tool)', kind: 'product', country: 'Country D' },
]

const e = (
  id: string,
  from: string,
  to: string,
  material: string,
  source: string,
  confidence: NetEdge['confidence'],
  effectiveFrom: string,
  extra: Partial<NetEdge> = {},
): NetEdge => ({ id, from, to, material, source, confidence, effectiveFrom, ...extra })

export const edges: NetEdge[] = [
  e('e1', 'w-supx', 'w-milly', 'wheat, milling grade', 'Curated supplier file v1', 'medium', '2025-01-01'),
  e('e2', 'w-supw', 'w-traderq', 'wheat, milling grade', 'Curated supplier file v1', 'low', '2025-03-01', {
    uncertain: true,
    note: 'Link inferred from shipping records; not confirmed by supplier.',
  }),
  e('e3', 'w-traderq', 'w-milly', 'wheat, milling grade', 'Curated supplier file v1', 'medium', '2025-03-01'),
  // Cycle for demonstration: Mill Y resells surplus to Trader Q
  e('e4', 'w-milly', 'w-traderq', 'wheat, surplus resale', 'Curated supplier file v1', 'low', '2025-06-01', {
    note: 'Back-flow link that creates a cycle; traversal must stop on revisit.',
  }),
  e('e5', 'w-milly', 'w-plantz', 'flour input', 'Curated supplier file v1', 'high', '2024-01-01'),
  e('e6', 'w-plantz', 'w-prodp', 'flour', 'Curated BOM v1', 'high', '2024-01-01'),

  e('e7', 't-minem', 't-conc', 'tungsten ore', 'Curated supplier file v1', 'high', '2024-06-01'),
  e('e8', 't-minen', 't-conc', 'tungsten ore', 'Curated supplier file v1', 'medium', '2025-02-01'),
  e('e9', 't-conc', 't-carbide', 'tungsten concentrate', 'Curated supplier file v1', 'medium', '2024-06-01', {
    note: 'Direct shipment assumed; APT route not confirmed.',
    uncertain: true,
  }),
  e('e10', 't-conc', 't-apt', 'tungsten concentrate', 'Curated supplier file v1', 'high', '2024-06-01'),
  e('e11', 't-apt', 't-carbide', 'APT / tungsten oxide', 'Curated supplier file v1', 'high', '2024-06-01'),
  e('e12', 't-carbide', 't-plantk', 'tungsten carbide powder', 'Curated BOM v1', 'high', '2024-01-01'),
  e('e13', 't-plantk', 't-prodr', 'carbide insert', 'Curated BOM v1', 'high', '2024-01-01'),
]

export const sources: SourceStatus[] = [
  { id: 'src-policy', name: 'Policy feed (simulator)', mode: 'simulated', lastUsable: '2026-11-08T14:20:00Z', policyHours: 24, state: 'ok' },
  { id: 'src-logistics', name: 'Logistics feed (simulator)', mode: 'simulated', lastUsable: '2026-11-08T08:05:00Z', policyHours: 12, state: 'stale' },
  { id: 'src-price', name: 'Price series (replay)', mode: 'replay', lastUsable: '2026-11-08T16:30:00Z', policyHours: 24, state: 'ok' },
]

export const actionSummaries: ActionSummary[] = [
  { commodity: 'wheat', open: 1, inProgress: 0, review: 0, done: 0 },
  { commodity: 'tungsten', open: 0, inProgress: 1, review: 1, done: 0 },
]

// Alerts raised per day, last 7 days.
export const trend: Record<Commodity, { day: string; count: number }[]> = {
  wheat: [
    { day: '03 Nov', count: 0 }, { day: '04 Nov', count: 1 }, { day: '05 Nov', count: 0 },
    { day: '06 Nov', count: 0 }, { day: '07 Nov', count: 1 }, { day: '08 Nov', count: 1 }, { day: '09 Nov', count: 0 },
  ],
  tungsten: [
    { day: '03 Nov', count: 0 }, { day: '04 Nov', count: 0 }, { day: '05 Nov', count: 1 },
    { day: '06 Nov', count: 1 }, { day: '07 Nov', count: 0 }, { day: '08 Nov', count: 1 }, { day: '09 Nov', count: 0 },
  ],
}

// Traversal of the mock network. Mirrors the server contract: direction, depth bound,
// material filter, cycle guard and a visible result limit.
export type Direction = 'upstream' | 'downstream' | 'both'

export interface TraverseResult {
  nodes: { node: NetNode; level: number }[]
  edges: NetEdge[]
  totalReachable: number
  truncated: boolean
  cycleEdgeIds: string[]
}

export function traverse(
  focusId: string,
  direction: Direction,
  depth: number,
  material: string,
  limit: number,
): TraverseResult {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const usable = edges.filter((x) => !material || x.material.toLowerCase().includes(material.toLowerCase()))
  const level = new Map<string, number>([[focusId, 0]])
  const seenEdges = new Set<string>()
  const queue: string[] = [focusId]

  while (queue.length) {
    const id = queue.shift()!
    const l = level.get(id)!
    if (Math.abs(l) >= depth) continue
    const steps: { edge: NetEdge; next: string; dir: 1 | -1 }[] = []
    if (direction !== 'downstream')
      usable.filter((x) => x.to === id).forEach((x) => steps.push({ edge: x, next: x.from, dir: -1 }))
    if (direction !== 'upstream')
      usable.filter((x) => x.from === id).forEach((x) => steps.push({ edge: x, next: x.to, dir: 1 }))
    for (const s of steps) {
      // keep the sign of the branch so upstream sits left and downstream right
      const branch = l === 0 ? s.dir : Math.sign(l)
      const nextLevel = branch * (Math.abs(l) + 1)
      if (level.has(s.next)) {
        seenEdges.add(s.edge.id)
        continue
      }
      level.set(s.next, nextLevel)
      seenEdges.add(s.edge.id)
      queue.push(s.next)
    }
  }

  // Cycle guard: a depth-first walk from the focus; an edge back to a node on the current path is a cycle.
  const cycleEdgeIds = new Set<string>()
  const walk = (dir: 'up' | 'down') => {
    const onPath = new Set<string>()
    const done = new Set<string>()
    const dfs = (id: string, d: number) => {
      onPath.add(id)
      for (const x of usable) {
        const hit = dir === 'down' ? x.from === id : x.to === id
        if (!hit) continue
        const next = dir === 'down' ? x.to : x.from
        if (onPath.has(next)) cycleEdgeIds.add(x.id)
        else if (!done.has(next) && d < depth) dfs(next, d + 1)
      }
      onPath.delete(id)
      done.add(id)
    }
    dfs(focusId, 0)
  }
  if (direction !== 'upstream') walk('down')
  if (direction !== 'downstream') walk('up')

  const ordered = [...level.entries()].sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))
  const kept = ordered.slice(0, limit)
  const keptIds = new Set(kept.map(([id]) => id))
  return {
    nodes: kept.map(([id, l]) => ({ node: byId.get(id)!, level: l })),
    edges: edges.filter((x) => seenEdges.has(x.id) && keptIds.has(x.from) && keptIds.has(x.to)),
    totalReachable: ordered.length,
    truncated: ordered.length > limit,
    cycleEdgeIds: [...cycleEdgeIds],
  }
}
