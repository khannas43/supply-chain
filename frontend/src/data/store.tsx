import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { IDENTITIES } from '../auth/users'
import { alerts as seedAlerts, NOW } from './mock'
import { initialAssumptions, initialVersions } from './impact'
import { seedActions, seedAudit } from './seedActions'
import type {
  ActionItem, ActionStatus, Alert, Assumption, AuditEntry, Disposition, ResponseOption, VersionNote,
} from './types'

// In-memory demo state shared across screens. It resets on reload and stands in for the API.

interface Store {
  alerts: Alert[]
  setDisposition: (id: string, d: Disposition, rationale: string) => void
  assumptions: Assumption[]
  versions: Record<string, VersionNote[]>
  currentVersion: (alertId: string) => number
  proposeAssumption: (alertId: string, sharePct: number, basis: string) => void
  decideAssumption: (id: string, decision: 'approved' | 'rejected', note: string) => { ok: boolean; error?: string }
  shortlist: string[]
  toggleShortlist: (optionId: string) => void
  actions: ActionItem[]
  createAction: (o: ResponseOption, input: { ownerId: string; targetDate: string; rationale: string }) => string
  updateStatus: (id: string, to: ActionStatus, note: string) => void
  reassign: (id: string, ownerId: string, note: string) => void
  audit: AuditEntry[]
  log: (event: string, ref: string, detail: string) => void
}

const Ctx = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [alerts, setAlerts] = useState<Alert[]>(seedAlerts)
  const [assumptions, setAssumptions] = useState<Assumption[]>(initialAssumptions)
  const [versions, setVersions] = useState(initialVersions)
  const [shortlist, setShortlist] = useState<string[]>([])
  const [actions, setActions] = useState<ActionItem[]>(seedActions)
  const [audit, setAudit] = useState<AuditEntry[]>(seedAudit)

  const log = useCallback(
    (event: string, ref: string, detail: string) =>
      setAudit((a) => [{ at: new Date().toISOString(), actor: user.name, event, ref, detail }, ...a]),
    [user.name],
  )

  const value = useMemo<Store>(() => {
    const currentVersion = (alertId: string) => (versions[alertId] ?? [{ v: 1 }]).slice(-1)[0].v
    return {
      alerts,
      setDisposition: (id, d, rationale) => {
        setAlerts((cur) => cur.map((a) => (a.id === id ? { ...a, disposition: d } : a)))
        log('alert.disposition', id, `${d}: ${rationale}`)
      },
      assumptions,
      versions,
      currentVersion,
      proposeAssumption: (alertId, sharePct, basis) => {
        const id = `AS-${alertId.slice(3, 4)}-${assumptions.filter((a) => a.alertId === alertId).length + 1}`
        setAssumptions((cur) => [
          ...cur.map((a) => (a.alertId === alertId && (a.status === 'proposed' || a.status === 'approved') ? { ...a, status: 'superseded' as const } : a)),
          { id, alertId, affectedSharePct: sharePct, basis, proposedBy: { id: user.id, name: user.name }, proposedAt: new Date().toISOString(), status: 'proposed' },
        ])
        log('assumption.proposed', id, `${sharePct}% affected share`)
      },
      decideAssumption: (id, decision, note) => {
        const a = assumptions.find((x) => x.id === id)
        if (!a) return { ok: false, error: 'Assumption not found.' }
        if (a.proposedBy.id === user.id) return { ok: false, error: 'You proposed this assumption; a different analyst must decide it.' }
        setAssumptions((cur) => cur.map((x) => (x.id === id ? { ...x, status: decision, decidedBy: { id: user.id, name: user.name }, decidedAt: new Date().toISOString(), decisionNote: note } : x)))
        if (decision === 'approved') {
          setVersions((cur) => {
            const list = cur[a.alertId] ?? []
            const v = (list.slice(-1)[0]?.v ?? 0) + 1
            return { ...cur, [a.alertId]: [...list, { v, at: new Date().toISOString(), note: `Assumption ${id} approved (${a.affectedSharePct}% affected share)` }] }
          })
        }
        log(`assumption.${decision}`, id, note || decision)
        return { ok: true }
      },
      shortlist,
      toggleShortlist: (optionId) => setShortlist((s) => (s.includes(optionId) ? s.filter((x) => x !== optionId) : [...s, optionId])),
      actions,
      createAction: (o, input) => {
        const alert = alerts.find((a) => a.id === o.alertId)!
        const owner = IDENTITIES.find((i) => i.id === input.ownerId)!
        const active = assumptions.filter((a) => a.alertId === o.alertId && a.status !== 'superseded').sort((a, b) => b.proposedAt.localeCompare(a.proposedAt))[0]
        const id = `AC-${alert.commodity[0].toUpperCase()}-${String(actions.filter((a) => a.commodity === alert.commodity).length + 1).padStart(3, '0')}`
        const now = new Date().toISOString()
        setActions((cur) => [
          ...cur,
          {
            id, alertId: o.alertId, commodity: alert.commodity, optionId: o.id, optionName: o.name,
            ownerId: owner.id, ownerName: owner.name, targetDate: input.targetDate, rationale: input.rationale,
            status: 'open', createdAt: now, createdBy: user.name, assessmentVersion: currentVersion(o.alertId),
            assumptionStatus: active?.status ?? 'none',
            history: [{ at: now, actor: user.name, from: null, to: 'open', note: 'Decision recorded' }],
          },
        ])
        log('decision.created', id, `${o.name}, owner ${owner.name}`)
        return id
      },
      updateStatus: (id, to, note) => {
        const now = new Date().toISOString()
        setActions((cur) => cur.map((a) => (a.id === id ? { ...a, status: to, history: [...a.history, { at: now, actor: user.name, from: a.status, to, note }] } : a)))
        log('action.status', id, `${to}${note ? `: ${note}` : ''}`)
      },
      reassign: (id, ownerId, note) => {
        const owner = IDENTITIES.find((i) => i.id === ownerId)!
        setActions((cur) => cur.map((a) => (a.id === id ? { ...a, ownerId, ownerName: owner.name, history: [...a.history, { at: new Date().toISOString(), actor: user.name, from: a.status, to: a.status, note: `Reassigned to ${owner.name}${note ? `: ${note}` : ''}` }] } : a)))
        log('action.reassigned', id, `to ${owner.name}`)
      },
      audit,
      log,
    }
  }, [alerts, assumptions, versions, shortlist, actions, audit, user, log])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useStore() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useStore outside StoreProvider')
  return v
}

export const TODAY = NOW.slice(0, 10)
