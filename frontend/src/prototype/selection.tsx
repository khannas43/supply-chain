import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_REQUIREMENT, DEFAULT_SCENARIO, DEFAULT_WEIGHTS, type Dim, type Requirement, type Scenario } from './data'
import { getLimit, useSettings } from './settings'

// Suppliers selected for comparison. Kept while moving between the dashboard and the comparison.
interface SelectionState {
  selected: string[]
  limit: number // the configured comparison limit (Configuration screen)
  requirement: Requirement
  setRequirement: (r: Requirement) => void
  weights: Record<Dim, number> // applied weightings (total 100)
  setWeights: (w: Record<Dim, number>) => void
  scenario: Scenario
  setScenario: (s: Scenario) => void
  toggle: (id: string) => void
  add: (id: string) => void
  remove: (id: string) => void
  clear: () => void
  atLimit: boolean
}

const Ctx = createContext<SelectionState | null>(null)
const KEY = 'proto.selection.v4'
// The prototype opens on the worked example: A to E plus F, which has incomplete data.
const DEFAULT = ['A', 'B', 'C', 'D', 'E', 'F']

interface Stored { selected: string[]; requirement: Requirement; weights: Record<Dim, number>; scenario: Scenario }
function load(): Stored {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) {
      const v = JSON.parse(raw)
      if (Array.isArray(v.selected)) return { selected: v.selected, requirement: { ...DEFAULT_REQUIREMENT, ...v.requirement }, weights: { ...DEFAULT_WEIGHTS, ...v.weights }, scenario: { ...DEFAULT_SCENARIO, ...v.scenario } }
    }
  } catch { /* storage unavailable: use defaults */ }
  return { selected: DEFAULT, requirement: DEFAULT_REQUIREMENT, weights: DEFAULT_WEIGHTS, scenario: DEFAULT_SCENARIO }
}

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(load)
  const { comparisonLimit: limit } = useSettings()
  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
  }, [state])

  const add = useCallback((id: string) => setState((s) => (s.selected.includes(id) || s.selected.length >= getLimit() ? s : { ...s, selected: [...s.selected, id] })), [])
  const remove = useCallback((id: string) => setState((s) => ({ ...s, selected: s.selected.filter((x) => x !== id) })), [])
  const toggle = useCallback((id: string) => setState((s) => (s.selected.includes(id) ? { ...s, selected: s.selected.filter((x) => x !== id) } : s.selected.length >= getLimit() ? s : { ...s, selected: [...s.selected, id] })), [])
  const clear = useCallback(() => setState((s) => ({ ...s, selected: [] })), [])
  const setWeights = useCallback((weights: Record<Dim, number>) => setState((s) => ({ ...s, weights })), [])
  const setScenario = useCallback((scenario: Scenario) => setState((s) => ({ ...s, scenario })), [])
  const setRequirement = useCallback((requirement: Requirement) => setState((s) => ({ ...s, requirement })), [])

  return (
    <Ctx.Provider value={{ selected: state.selected, limit, requirement: state.requirement, setRequirement, weights: state.weights, setWeights, scenario: state.scenario, setScenario, toggle, add, remove, clear, atLimit: state.selected.length >= limit }}>
      {children}
    </Ctx.Provider>
  )
}

export function useSelection() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useSelection outside SelectionProvider')
  return v
}
