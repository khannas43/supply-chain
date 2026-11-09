import { useSearchParams } from 'react-router-dom'
import { assessmentBase } from '../data/impact'
import { useStore } from '../data/store'
import { useApp } from './AppContext'
import type { Alert } from '../data/types'

// Alerts that have an assessment, for the current commodity. The selection lives in ?alert=.
export function useAssessedAlert(): { alert: Alert | undefined; list: Alert[]; set: (id: string) => void } {
  const { commodity } = useApp()
  const { alerts } = useStore()
  const [params, setParams] = useSearchParams()
  const list = alerts.filter((a) => a.commodity === commodity && assessmentBase[a.id])
  const alert = list.find((a) => a.id === params.get('alert')) ?? list[0]
  return { alert, list, set: (id) => setParams({ alert: id }) }
}

export function AlertPicker({ list, value, onChange }: { list: Alert[]; value?: string; onChange: (id: string) => void }) {
  return (
    <div className="field">
      <label htmlFor="alert-pick">Alert</label>
      <select id="alert-pick" value={value} onChange={(e) => onChange(e.target.value)}>
        {list.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.title}</option>)}
      </select>
    </div>
  )
}
