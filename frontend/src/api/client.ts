import type { Identity } from '../data/types'

// Development identity sent with write requests. Replaced by the Keycloak access token later.
let actor: Identity | null = null
export const setApiActor = (a: Identity | null) => {
  actor = a
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
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (actor) {
    headers['X-Actor-Id'] = actor.id
    headers['X-Actor-Name'] = actor.name
    headers['X-Actor-Role'] = actor.role
  }
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError('The API is not reachable. Is the stack running (docker compose up -d)?', 0)
  }
  if (!res.ok) {
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

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body: unknown) => request<T>('POST', path, body),
}
