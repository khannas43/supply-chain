// Roles and screen access mirror docs/screens-roles-rbac.md (section 4).
// The server enforces access; this only drives navigation and button visibility.

export type Role = 'viewer' | 'analyst' | 'manager' | 'steward' | 'admin' | 'demo_operator'

export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Executive Viewer',
  analyst: 'Risk Analyst',
  manager: 'Procurement Manager',
  steward: 'Data Steward',
  admin: 'Platform Admin',
  demo_operator: 'Demo Operator',
}

export type ScreenId = 'S01' | 'S02' | 'S03' | 'S04' | 'S05' | 'S06' | 'S07' | 'S08' | 'S09' | 'RP1' | 'RP2' | 'RP3' | 'RP4'

const ALL: Role[] = ['viewer', 'analyst', 'manager', 'steward', 'admin', 'demo_operator']

export const SCREEN_VIEW: Record<ScreenId, Role[]> = {
  S01: ALL,
  S02: ALL,
  S03: ALL,
  S04: ALL,
  S05: ALL,
  S06: ALL,
  S07: ['analyst', 'steward', 'admin', 'demo_operator'],
  S08: ['analyst', 'steward', 'admin'],
  S09: ['admin', 'demo_operator'],
  RP1: ALL,
  RP2: ALL,
  RP3: ALL,
  RP4: ['analyst', 'steward', 'admin', 'demo_operator'],
}

export type Capability =
  | 'alert.disposition'
  | 'assumption.propose'
  | 'assumption.approve'
  | 'option.shortlist'
  | 'decision.create'
  | 'action.manage'
  | 'action.update'
  | 'data.import'
  | 'quarantine.resolve'
  | 'source.toggle'
  | 'rule.draft'
  | 'rule.publish'
  | 'reference.edit'
  | 'simulator.run'
  | 'evidence.raw'

export const CAPABILITY: Record<Capability, Role[]> = {
  'alert.disposition': ['analyst'],
  'assumption.propose': ['analyst'],
  'assumption.approve': ['analyst'],
  'option.shortlist': ['analyst', 'manager'],
  'decision.create': ['manager'],
  'action.manage': ['manager'],
  'action.update': ['manager', 'admin'],
  'data.import': ['steward', 'admin'],
  'quarantine.resolve': ['steward', 'admin'],
  'source.toggle': ['admin'],
  'rule.draft': ['analyst', 'admin'],
  'rule.publish': ['analyst', 'admin'],
  'reference.edit': ['steward', 'admin'],
  'simulator.run': ['admin', 'demo_operator'],
  'evidence.raw': ['analyst', 'manager', 'steward', 'admin'],
}
