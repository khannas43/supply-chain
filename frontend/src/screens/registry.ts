import type { ScreenId } from '../auth/roles'

export interface ScreenDef {
  id: ScreenId
  path: string
  label: string
  purpose: string
  group: 'Product' | 'Reports' | 'Support'
  // Phase 2 or superseded by the tungsten purchasing MVP: kept in code, hidden from the menu and routes
  hidden?: boolean
  // reachable by link (for example a supplier profile) but not listed in the menu
  noMenu?: boolean
}

export const SCREENS: ScreenDef[] = [
  { id: 'MS11', path: '/market', label: 'Market overview', group: 'Product', purpose: 'Tungsten supply, trade, price and country risk.' },
  { id: 'MS12', path: '/suppliers', label: 'Supplier dashboard', group: 'Product', purpose: 'Every supplier with indicative ratings; select suppliers to compare.' },
  { id: 'MS04', path: '/suppliers/:id', label: 'Supplier profile', group: 'Product', purpose: 'One supplier, with the source and date behind each item.', noMenu: true },
  { id: 'MS01', path: '/requirement', label: 'Requirement', group: 'Product', purpose: 'Define the purchase and the suppliers to compare.' },
  { id: 'MS02', path: '/data', label: 'Data & quotes', group: 'Product', purpose: 'Credibl freshness and client quote upload.' },
  { id: 'MS03', path: '/comparison', label: 'Comparison', group: 'Product', purpose: 'Ranked comparison on landed cost and three risk dimensions.' },
  { id: 'MS05', path: '/stress', label: 'Stress test', group: 'Product', purpose: 'Re-rank under China export-licence tightening.' },
  { id: 'MS06', path: '/decision', label: 'Decision & pack', group: 'Product', purpose: 'Record the recommendation, review it and issue the pack.' },
  { id: 'S01', path: '/overview', label: 'Overview', group: 'Product', purpose: 'Exposure, impact and action status per commodity.', hidden: true },
  { id: 'S02', path: '/risk', label: 'Risk inbox', group: 'Product', purpose: 'Review incoming risk signals and set a disposition.', hidden: true },
  { id: 'S03', path: '/network', label: 'Supplier network', group: 'Product', purpose: 'Explore upstream and downstream supplier links.', hidden: true },
  { id: 'S04', path: '/impact', label: 'Impact assessment', group: 'Product', purpose: 'Supported business impact and the assumptions behind it.', hidden: true },
  { id: 'S05', path: '/response', label: 'Response comparison', group: 'Product', purpose: 'Compare qualified alternatives and response options.', hidden: true },
  { id: 'S06', path: '/actions', label: 'Action register', group: 'Product', purpose: 'Record and track decisions, owners and status.' },
  { id: 'S07', path: '/sources', label: 'Source health', group: 'Product', purpose: 'Source freshness, ingestion runs and quarantine.' },
  { id: 'RP1', path: '/reports/risk-exposure', label: 'Risk exposure', group: 'Reports', purpose: 'Where open risk sits and how far it has been assessed.', hidden: true },
  { id: 'RP2', path: '/reports/supplier-concentration', label: 'Supplier concentration', group: 'Reports', purpose: 'Dependence on single countries and single links.', hidden: true },
  { id: 'RP3', path: '/reports/actions', label: 'Actions and decisions', group: 'Reports', purpose: 'Progress, ownership and what is late or out of date.', hidden: true },
  { id: 'RP4', path: '/reports/data-lifecycle', label: 'Data life cycle', group: 'Reports', purpose: 'Source to decision, and whether the links between steps hold.', hidden: true },
  { id: 'MS08', path: '/configuration', label: 'Configuration', group: 'Support', purpose: 'Comparison limit and other settings, with a change log.' },
  { id: 'MS10', path: '/master', label: 'Supplier master', group: 'Support', purpose: 'Supplier identities, aliases and qualification.' },
  { id: 'MS09', path: '/review', label: 'Data review', group: 'Support', purpose: 'Rejected rows and unconfirmed matches.' },
  { id: 'S08', path: '/rules', label: 'Rules and data', group: 'Support', purpose: 'Risk rules, assumptions, imports and reference data.' },
  { id: 'S09', path: '/simulator', label: 'Simulator', group: 'Support', purpose: 'Drive repeatable scenarios and inject failures.' },
]
