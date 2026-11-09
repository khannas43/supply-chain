import { useCallback, useEffect, useState } from 'react'
import { api } from './client'

export interface Remote<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => void
}

// Loads a path. Keeps the previous data while a new request is in flight so screens do not flicker.
export function useApi<T>(path: string | null, opts: { pollMs?: number } = {}): Remote<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(path !== null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (path === null) return
    let live = true
    setLoading((was) => was || data === null)
    api
      .get<T>(path)
      .then((d) => live && (setData(d), setError(null)))
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [path, tick])

  // Refresh in the background (for screens that show what the worker is doing). Skipped while the tab is hidden.
  const { pollMs } = opts
  useEffect(() => {
    if (!pollMs || path === null) return
    const id = setInterval(() => !document.hidden && setTick((t) => t + 1), pollMs)
    return () => clearInterval(id)
  }, [pollMs, path])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload }
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}
