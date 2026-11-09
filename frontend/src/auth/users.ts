import type { Identity } from '../data/types'

// Development identities standing in for Keycloak users. Two analysts exist so the
// proposer and approver of an assumption can be different people.
export const IDENTITIES: Identity[] = [
  { id: 'u-viewer', name: 'Executive Viewer', role: 'viewer' },
  { id: 'u-analyst-a', name: 'Risk Analyst A', role: 'analyst' },
  { id: 'u-analyst-b', name: 'Risk Analyst B', role: 'analyst' },
  { id: 'u-manager', name: 'Procurement Manager', role: 'manager' },
  { id: 'u-steward', name: 'Data Steward', role: 'steward' },
  { id: 'u-admin', name: 'Platform Admin', role: 'admin' },
  { id: 'u-demo', name: 'Demo Operator', role: 'demo_operator' },
]
