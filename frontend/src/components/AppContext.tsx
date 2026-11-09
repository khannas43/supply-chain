import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Commodity, Evidence, Mode } from '../data/types'

export interface EvidenceView {
  title: string
  evidence: Evidence
  mode: Mode
  scenarioRun?: string
  ruleVersion?: string
}

interface AppState {
  commodity: Commodity
  setCommodity: (c: Commodity) => void
  evidence: EvidenceView | null
  openEvidence: (e: EvidenceView) => void
  closeEvidence: () => void
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [commodity, setCommodity] = useState<Commodity>('wheat')
  const [evidence, setEvidence] = useState<EvidenceView | null>(null)
  return (
    <Ctx.Provider
      value={{ commodity, setCommodity, evidence, openEvidence: setEvidence, closeEvidence: () => setEvidence(null) }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useApp() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside AppProvider')
  return v
}
