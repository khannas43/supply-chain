import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, UserManager, WebStorageStateStore } from 'oidc-client-ts'
import { setApiActor, setApiToken, setUnauthorizedHandler } from '../api/client'
import type { Commodity } from '../data/types'
import { CAPABILITY, ROLE_LABEL, SCREEN_VIEW, type Capability, type Role, type ScreenId } from './roles'
import { IDENTITIES } from './users'

export interface SessionUser {
  id: string
  name: string
  roles: Role[]
  scope: Commodity[] | null // commodities this user may see; null means all
}

interface Auth {
  mode: 'dev' | 'keycloak'
  user: SessionUser
  setUserId: (id: string) => void // dev mode only
  signOut: () => void
  canView: (s: ScreenId) => boolean
  can: (c: Capability) => boolean
}

const Ctx = createContext<Auth | null>(null)

const ALL_ROLES = Object.keys(ROLE_LABEL) as Role[]
const COMMODITIES: Commodity[] = ['wheat', 'tungsten']

function authority(user: SessionUser) {
  return {
    canView: (s: ScreenId) => SCREEN_VIEW[s].some((r) => user.roles.includes(r)),
    can: (c: Capability) => CAPABILITY[c].some((r) => user.roles.includes(r)),
  }
}

// ---- screens shown before there is a session ----

function Centered({ children }: { children: ReactNode }) {
  return <div className="center-screen"><div className="card center-card">{children}</div></div>
}

// ---- dev mode: identity switch ----

function DevAuth({ children }: { children: ReactNode }) {
  // Dev only: ?as=u-demo opens the app as that identity, which makes role-specific screens easy to check.
  const [userId, setUserId] = useState(() => {
    const asked = new URLSearchParams(window.location.search).get('as')
    return IDENTITIES.some((i) => i.id === asked) ? asked! : 'u-analyst-a'
  })
  const value = useMemo<Auth>(() => {
    const identity = IDENTITIES.find((i) => i.id === userId)!
    setApiToken(null)
    setApiActor(identity) // set during render so requests made by child effects already carry the identity
    const user: SessionUser = { id: identity.id, name: identity.name, roles: [identity.role], scope: identity.scope ?? null }
    return { mode: 'dev', user, setUserId, signOut: () => undefined, ...authority(user) }
  }, [userId])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// ---- keycloak: Authorization Code with PKCE ----

function decodeClaims(token: string): Record<string, unknown> {
  const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const bytes = Uint8Array.from(atob(part), (c) => c.charCodeAt(0))
  return JSON.parse(new TextDecoder().decode(bytes))
}

// The roles and scope come from the access token for the interface only; the API checks the signed token itself.
function sessionFrom(user: User): SessionUser {
  const claims = decodeClaims(user.access_token) as {
    sub: string; name?: string; preferred_username?: string; realm_access?: { roles?: string[] }; commodity_scope?: string | string[]
  }
  const scopeClaim = claims.commodity_scope
  return {
    id: claims.sub,
    name: claims.name ?? claims.preferred_username ?? claims.sub,
    roles: (claims.realm_access?.roles ?? []).filter((r): r is Role => (ALL_ROLES as string[]).includes(r)),
    scope: scopeClaim === undefined ? null : ((Array.isArray(scopeClaim) ? scopeClaim : [scopeClaim]).filter((c): c is Commodity => (COMMODITIES as string[]).includes(c))),
  }
}

let pendingCallback: Promise<User> | null = null // React StrictMode runs effects twice; the callback may be consumed once

function KeycloakAuth({ config, children }: { config: { authority: string; clientId: string }; children: ReactNode }) {
  const manager = useMemo(
    () =>
      new UserManager({
        authority: config.authority,
        client_id: config.clientId,
        redirect_uri: `${window.location.origin}/auth/callback`,
        post_logout_redirect_uri: `${window.location.origin}/`,
        response_type: 'code',
        scope: 'openid profile',
        automaticSilentRenew: true,
        userStore: new WebStorageStateStore({ store: window.sessionStorage }),
      }),
    [config],
  )
  const navigate = useNavigate()
  const [oidcUser, setOidcUser] = useState<User | null | undefined>(undefined) // undefined: still checking
  const [error, setError] = useState<string | null>(null)
  const current = useRef<User | null>(null)
  current.current = oidcUser ?? null

  useEffect(() => {
    setApiToken(() => current.current?.access_token ?? null)
    setUnauthorizedHandler(() => {
      void manager.removeUser()
      setOidcUser(null)
    })
    const onLoaded = (u: User) => setOidcUser(u)
    const onGone = () => setOidcUser(null)
    manager.events.addUserLoaded(onLoaded)
    manager.events.addUserUnloaded(onGone)
    manager.events.addSilentRenewError(onGone)
    ;(async () => {
      try {
        if (window.location.pathname === '/auth/callback') {
          pendingCallback ??= manager.signinRedirectCallback()
          const u = await pendingCallback
          // go back to the page that was asked for; through the router, so it renders that route
          navigate((u.state as { returnTo?: string } | undefined)?.returnTo ?? '/', { replace: true })
          setOidcUser(u)
        } else {
          const u = await manager.getUser()
          setOidcUser(u && !u.expired ? u : null)
        }
      } catch (e) {
        pendingCallback = null
        navigate('/', { replace: true })
        setError((e as Error).message)
        setOidcUser(null)
      }
    })()
    return () => {
      manager.events.removeUserLoaded(onLoaded)
      manager.events.removeUserUnloaded(onGone)
      manager.events.removeSilentRenewError(onGone)
    }
  }, [manager, navigate])

  const session = useMemo(() => (oidcUser ? sessionFrom(oidcUser) : null), [oidcUser])
  const value = useMemo<Auth | null>(
    () => session && { mode: 'keycloak', user: session, setUserId: () => undefined, signOut: () => void manager.signoutRedirect(), ...authority(session) },
    [session, manager],
  )

  if (oidcUser === undefined) return <Centered><div role="status">Signing in…</div></Centered>
  if (!session || !value) {
    return (
      <div className="signin">
        <div className="signin-hero">
          <div className="signin-mark" aria-hidden="true" />
          <h1>Supply Chain Risk</h1>
          <p>Know where wheat and tungsten supply is exposed, and decide what to do about it.</p>
          <ol className="signin-steps">
            <li><strong>Map</strong><span>Suppliers, routes and stock across tiers</span></li>
            <li><strong>Detect</strong><span>Policy, logistics and price signals as they arrive</span></li>
            <li><strong>Assess</strong><span>Supported impact, with the assumptions shown</span></li>
            <li><strong>Act</strong><span>Compare responses and track decisions</span></li>
          </ol>
        </div>
        <div className="signin-panel">
          <h2>Welcome back</h2>
          <p className="muted">Sign in with your work account to continue.</p>
          {error && <div className="notice" role="alert">Sign-in did not complete: {error}</div>}
          <button className="btn primary signin-btn" onClick={() => void manager.signinRedirect({ state: { returnTo: window.location.pathname + window.location.search } })}>Sign in</button>
          <p className="muted small">Access depends on your role. Sample data in this environment is simulated or replayed and labelled as such.</p>
        </div>
      </div>
    )
  }
  if (session.roles.length === 0) {
    return (
      <Centered>
        <h1>No access yet</h1>
        <p>You are signed in as <strong>{session.name}</strong>, but your account has no role in this application. Ask an administrator to give you one.</p>
        <button className="btn" onClick={() => void manager.signoutRedirect()}>Sign out</button>
      </Centered>
    )
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

// ---- entry point: ask the API how to sign in ----

type Config = { mode: 'dev' } | { mode: 'keycloak'; authority: string; clientId: string }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<Config | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    fetch('/api/auth/config')
      .then((r) => (r.ok ? (r.json() as Promise<Config>) : Promise.reject(new Error(`Request failed (${r.status})`))))
      .then((c) => live && (setConfig(c), setError(null)))
      .catch(() => live && setError('The API is not reachable. Is the stack running (docker compose up -d)?'))
    return () => {
      live = false
    }
  }, [attempt])

  if (error) {
    return (
      <Centered>
        <div className="notice" role="alert">{error}</div>
        <button className="btn" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
      </Centered>
    )
  }
  if (!config) return <Centered><div role="status">Loading…</div></Centered>
  return config.mode === 'keycloak' ? <KeycloakAuth config={config}>{children}</KeycloakAuth> : <DevAuth>{children}</DevAuth>
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
