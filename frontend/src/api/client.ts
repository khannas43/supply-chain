import type { Identity } from '../data/types'

// How requests identify the caller. With Keycloak it is the access token; in dev mode it is the
// development identity sent as headers (the server only honours those in dev mode).
let actor: Identity | null = null
let tokenSource: (() => string | null) | null = null
let onUnauthorized: (() => void) | null = null

export const setApiActor = (a: Identity | null) => {
  actor = a
}
export const setApiToken = (source: (() => string | null) | null) => {
  tokenSource = source
}
export const setUnauthorizedHandler = (handler: (() => void) | null) => {
  onUnauthorized = handler
}

function authHeaders(): Record<string, string> {
  if (tokenSource) {
    const token = tokenSource()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }
  if (!actor) return {}
  return {
    'X-Actor-Id': actor.id,
    'X-Actor-Name': actor.name,
    'X-Actor-Role': actor.role,
    ...(actor.scope ? { 'X-Actor-Scope': actor.scope.join(',') } : {}),
  }
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

function describe(detail: unknown, fallback: string): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    // FastAPI validation errors: [{ loc: [...], msg: '...' }]
    return detail.map((d) => `${(d.loc ?? []).slice(1).join('.') || 'request'}: ${d.msg}`).join('; ')
  }
  return fallback
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...authHeaders() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError('The API is not reachable. Is the stack running (docker compose up -d)?', 0)
  }
  if (!res.ok) {
    if (res.status === 401 && tokenSource) onUnauthorized?.()
    let detail: unknown
    try {
      detail = (await res.json()).detail
    } catch {
      /* not JSON */
    }
    throw new ApiError(describe(detail, `Request failed (${res.status})`), res.status)
  }
  return res.json() as Promise<T>
}

// The original payload exactly as stored, with the checksum the server verified.
async function raw(path: string): Promise<{ body: string; sha256: string | null }> {
  const headers = authHeaders()
  let res: Response
  try {
    res = await fetch(`/api${path}`, { headers })
  } catch {
    throw new ApiError('The API is not reachable. Is the stack running (docker compose up -d)?', 0)
  }
  if (!res.ok) {
    if (res.status === 401 && tokenSource) onUnauthorized?.()
    let detail: unknown
    try {
      detail = (await res.json()).detail
    } catch {
      /* not JSON */
    }
    throw new ApiError(describe(detail, `Request failed (${res.status})`), res.status)
  }
  return { body: await res.text(), sha256: res.headers.get('X-Content-SHA256') }
}

export const api = {
  raw,
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body: unknown) => request<T>('POST', path, body),
}
