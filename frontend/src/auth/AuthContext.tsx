import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { CAPABILITY, SCREEN_VIEW, type Capability, type ScreenId } from './roles'
import { IDENTITIES } from './users'
import { setApiActor } from '../api/client'
import type { Identity } from '../data/types'

interface Auth {
  user: Identity
  setUserId: (id: string) => void
  canView: (s: ScreenId) => boolean
  can: (c: Capability) => boolean
}

const Ctx = createContext<Auth | null>(null)

// Development stand-in for Keycloak. Replace with the OIDC session (identity and roles from
// the token) when the realm is available; the rest of the app only uses canView/can.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState('u-analyst-a')
  const value = useMemo<Auth>(() => {
    const user = IDENTITIES.find((i) => i.id === userId)!
    setApiActor(user) // set during render so requests made by child effects already carry the identity
    return {
      user,
      setUserId,
      canView: (s) => SCREEN_VIEW[s].includes(user.role),
      can: (c) => CAPABILITY[c].includes(user.role),
    }
  }, [userId])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
