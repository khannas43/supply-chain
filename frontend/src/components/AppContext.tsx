import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
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
  const { user } = useAuth()
  const [commodity, setCommodity] = useState<Commodity>(user.scope?.[0] ?? 'wheat')
  // a user limited to one commodity never lands on another
  useEffect(() => {
    if (user.scope && !user.scope.includes(commodity)) setCommodity(user.scope[0] ?? commodity)
  }, [user, commodity])
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
