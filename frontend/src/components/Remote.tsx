import type { ReactNode } from 'react'
import type { Remote } from '../api/hooks'

// Shows loading and error states for data from the API. Renders children once data exists.
export function Loaded<T>({ remote, children }: { remote: Remote<T>; children: (data: T) => ReactNode }) {
  if (remote.data === null) {
    if (remote.error) {
      return (
        <div className="notice" role="alert">
          {remote.error} <button className="btn" onClick={remote.reload}>Retry</button>
        </div>
      )
    }
    return <div className="empty" role="status">Loading…</div>
  }
  return (
    <>
      {remote.error && (
        <div className="notice" role="alert">
          Could not refresh: {remote.error} <button className="btn" onClick={remote.reload}>Retry</button>
        </div>
      )}
      {children(remote.data)}
    </>
  )
}
