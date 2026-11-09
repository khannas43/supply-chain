import type { AssessmentBase, Assumption, ResponseOption, VersionNote } from './types'

// Synthetic assessments. Wheat follows docs/data-to-dashboard-workflow.md section 6:
// 100 t exposed, 120 t usable stock, 20 t/day demand, 10-day alternative lead time,
// USD 230 vs 200 per tonne. Tungsten values are invented for the demo.

export const assessmentBase: Record<string, AssessmentBase> = {
  'AL-W-001': {
    alertId: 'AL-W-001',
    calcVersion: 'impact-calc 0.3',
    exposed: { value: 100, unit: 't', horizon: '30 days' },
    referenceOptionId: 'O-W-1',
    paths: [
      { nodes: ['Supplier X (Country A)', 'Mill Y', 'Plant Z', 'Product P'], classification: 'potential', basis: 'Country match; sourcing share from Supplier X not confirmed (link confidence: medium)' },
      { nodes: ['Supplier W (Country B)', 'Trader Q', 'Mill Y'], classification: 'unknown', basis: 'Link inferred from shipping records; not part of this event' },
    ],
    inputs: {
      asOf: '2026-11-07',
      usableStock: 120,
      stockUnit: 't',
      demandPerDay: 20,
      baselinePrice: 200,
      currency: 'USD',
      priceUnit: 'per t',
      notes: ['Usable stock only; reserved stock excluded', 'Constant demand, no other receipts assumed'],
    },
    missing: ['Freight and other additional costs (not included in the cost figure)', 'Share of Mill Y volume sourced from Supplier X (allocation unknown)'],
  },
  'AL-T-001': {
    alertId: 'AL-T-001',
    calcVersion: 'impact-calc 0.3',
    exposed: { value: 18, unit: 't WO3 eq.', horizon: '90 days' },
    referenceOptionId: 'O-T-1',
    paths: [
      { nodes: ['Mine M (Country T)', 'Concentrator C', 'Carbide Maker K', 'Plant K', 'Product R'], classification: 'confirmed', basis: 'Direct supplier contract; Concentrator C route to Carbide Maker K assumed direct (uncertain link)' },
      { nodes: ['Mine M (Country T)', 'Concentrator C', 'APT Refiner R', 'Carbide Maker K'], classification: 'potential', basis: 'APT route; share of volume not confirmed' },
    ],
    inputs: {
      asOf: '2026-11-06',
      usableStock: 9,
      stockUnit: 't WO3 eq.',
      demandPerDay: 0.2,
      baselinePrice: 38000,
      currency: 'USD',
      priceUnit: 'per t WO3 eq.',
      notes: ['Usable stock only', 'Constant demand, no other receipts assumed'],
    },
    missing: ['Inbound receipts schedule not supplied (time-phased balance not possible)', 'Freight and duties not included in the cost figure'],
  },
}

export const initialVersions: Record<string, VersionNote[]> = {
  'AL-W-001': [{ v: 1, at: '2026-11-07T15:00:00Z', note: 'Initial partial assessment: exposure and cover only' }],
  'AL-T-001': [
    { v: 1, at: '2026-11-06T11:00:00Z', note: 'Initial partial assessment: exposure and cover only' },
    { v: 2, at: '2026-11-07T09:30:00Z', note: 'Disruption assumption AS-T-1 approved (60% affected share)' },
  ],
}

export const initialAssumptions: Assumption[] = [
  {
    id: 'AS-W-1',
    alertId: 'AL-W-001',
    affectedSharePct: 100,
    basis: 'Scenario: all contracted Country A volume replaced over the horizon (worked example).',
    proposedBy: { id: 'u-analyst-a', name: 'Risk Analyst A' },
    proposedAt: '2026-11-08T10:00:00Z',
    status: 'proposed',
  },
  {
    id: 'AS-T-1',
    alertId: 'AL-T-001',
    affectedSharePct: 60,
    basis: 'Licence tightening expected to cut concentrate exports by 60% over 90 days (SME estimate, simulated).',
    proposedBy: { id: 'u-analyst-a', name: 'Risk Analyst A' },
    proposedAt: '2026-11-06T16:00:00Z',
    status: 'approved',
    decidedBy: { id: 'u-analyst-b', name: 'Risk Analyst B' },
    decidedAt: '2026-11-07T09:30:00Z',
    decisionNote: 'Accepted for scenario purposes.',
  },
]

export interface Calc {
  coverDays: number | null
  atRisk: number | null
  gapDays: number | null
  incrementalCost: number | null
  reason: string | null // why the dependent metrics are unavailable
}

export function activeAssumption(list: Assumption[], alertId: string): Assumption | undefined {
  return list
    .filter((a) => a.alertId === alertId && a.status !== 'superseded')
    .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt))[0]
}

export function referencePrice(opt: ResponseOption | undefined) {
  return opt?.unitPrice
}

// Cover needs usable stock and a non-zero demand rate. At-risk volume, availability gap and
// incremental cost all need an approved disruption assumption; without one they stay unavailable.
export function calculate(
  base: AssessmentBase,
  assumption: Assumption | undefined,
  reference: ResponseOption | undefined,
): Calc {
  const { usableStock, demandPerDay, baselinePrice } = base.inputs
  const coverDays = demandPerDay > 0 ? usableStock / demandPerDay : null
  if (!assumption) return { coverDays, atRisk: null, gapDays: null, incrementalCost: null, reason: 'No disruption assumption has been proposed.' }
  if (assumption.status !== 'approved') {
    const why = assumption.status === 'proposed' ? 'The disruption assumption is awaiting approval.' : 'The disruption assumption was rejected.'
    return { coverDays, atRisk: null, gapDays: null, incrementalCost: null, reason: why }
  }
  const atRisk = (base.exposed.value * assumption.affectedSharePct) / 100
  const gapDays = coverDays != null && reference ? Math.max(0, reference.leadTimeDays - coverDays) : null
  const incrementalCost =
    reference?.unitPrice != null ? Math.round(atRisk * (reference.unitPrice - baselinePrice)) : null
  return { coverDays, atRisk, gapDays, incrementalCost, reason: null }
}
