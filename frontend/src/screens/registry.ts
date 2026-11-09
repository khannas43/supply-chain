import type { ScreenId } from '../auth/roles'

export interface ScreenDef {
  id: ScreenId
  path: string
  label: string
  purpose: string
  group: 'Product' | 'Support'
}

export const SCREENS: ScreenDef[] = [
  { id: 'S01', path: '/overview', label: 'Overview', group: 'Product', purpose: 'Exposure, impact and action status per commodity.' },
  { id: 'S02', path: '/risk', label: 'Risk inbox', group: 'Product', purpose: 'Review incoming risk signals and set a disposition.' },
  { id: 'S03', path: '/network', label: 'Supplier network', group: 'Product', purpose: 'Explore upstream and downstream supplier links.' },
  { id: 'S04', path: '/impact', label: 'Impact assessment', group: 'Product', purpose: 'Supported business impact and the assumptions behind it.' },
  { id: 'S05', path: '/response', label: 'Response comparison', group: 'Product', purpose: 'Compare qualified alternatives and response options.' },
  { id: 'S06', path: '/actions', label: 'Action register', group: 'Product', purpose: 'Record and track decisions, owners and status.' },
  { id: 'S07', path: '/sources', label: 'Source health', group: 'Product', purpose: 'Source freshness, ingestion runs and quarantine.' },
  { id: 'S08', path: '/rules', label: 'Rules and data', group: 'Support', purpose: 'Risk rules, assumptions, imports and reference data.' },
  { id: 'S09', path: '/simulator', label: 'Simulator', group: 'Support', purpose: 'Drive repeatable scenarios and inject failures.' },
]
