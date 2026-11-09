import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { IDENTITIES } from '../auth/users'
import { alerts as seedAlerts, NOW } from './mock'
import { initialAssumptions, initialVersions } from './impact'
import type {
  ActionItem, ActionStatus, Alert, Assumption, AuditEntry, Disposition, ResponseOption, VersionNote,
} from './types'

// In-memory demo state shared across screens. It resets on reload and stands in for the API.

const seedActions: ActionItem[] = [
  {
    id: 'AC-W-001',
    alertId: 'AL-W-001',
    commodity: 'wheat',
    optionId: 'O-W-1',
    optionName: 'Alternative Supplier V',
    ownerId: 'u-manager',
    ownerName: 'Procurement Manager',
    targetDate: '2026-11-18',
    rationale: 'Only qualified sourcing option; open commercial talks and request a firm quote while the assumption is being approved.',
    status: 'in_progress',
    createdAt: '2026-11-08T11:00:00Z',
    createdBy: 'Procurement Manager',
    assessmentVersion: 1,
    assumptionStatus: 'proposed',
    history: [
      { at: '2026-11-08T11:00:00Z', actor: 'Procurement Manager', from: null, to: 'open', note: 'Decision recorded' },
      { at: '2026-11-08T15:30:00Z', actor: 'Procurement Manager', from: 'open', to: 'in_progress', note: 'Supplier V contacted for a firm quote' },
    ],
  },
  {
    id: 'AC-W-002',
    alertId: 'AL-W-001',
    commodity: 'wheat',
    optionId: 'O-W-3',
    optionName: 'Transfer stock from Plant Z2',
    ownerId: 'u-analyst-b',
    ownerName: 'Risk Analyst B',
    targetDate: '2026-11-08',
    rationale: 'Bridge cover with 40 t from Plant Z2 while the alternative supplier is arranged.',
    status: 'review',
    createdAt: '2026-11-08T11:15:00Z',
    createdBy: 'Procurement Manager',
    assessmentVersion: 1,
    assumptionStatus: 'proposed',
    history: [
      { at: '2026-11-08T11:15:00Z', actor: 'Procurement Manager', from: null, to: 'open', note: 'Decision recorded' },
      { at: '2026-11-08T16:00:00Z', actor: 'Risk Analyst B', from: 'open', to: 'review', note: 'Transfer quantity confirmed with Plant Z2, ready for review' },
    ],
  },
  {
    id: 'AC-T-001',
    alertId: 'AL-T-001',
    commodity: 'tungsten',
    optionId: 'O-T-1',
    optionName: 'Alternative APT supplier, Country V',
    ownerId: 'u-manager',
    ownerName: 'Procurement Manager',
    targetDate: '2026-11-20',
    rationale: 'Only qualified option that covers the horizon; start sample qualification and commercial talks.',
    status: 'in_progress',
    createdAt: '2026-11-07T10:00:00Z',
    createdBy: 'Procurement Manager',
    assessmentVersion: 2,
    assumptionStatus: 'approved',
    history: [
      { at: '2026-11-07T10:00:00Z', actor: 'Procurement Manager', from: null, to: 'open', note: 'Decision recorded' },
      { at: '2026-11-08T09:00:00Z', actor: 'Procurement Manager', from: 'open', to: 'in_progress', note: 'Supplier contacted' },
    ],
  },
  {
    id: 'AC-T-002',
    alertId: 'AL-T-001',
    commodity: 'tungsten',
    optionId: 'O-T-3',
    optionName: 'Release strategic stock',
    ownerId: 'u-analyst-a',
    ownerName: 'Risk Analyst A',
    targetDate: '2026-11-08',
    rationale: 'Bridge cover while the alternative supplier qualifies.',
    status: 'review',
    createdAt: '2026-11-06T17:00:00Z',
    createdBy: 'Procurement Manager',
    assessmentVersion: 1,
    assumptionStatus: 'proposed',
    history: [
      { at: '2026-11-06T17:00:00Z', actor: 'Procurement Manager', from: null, to: 'open', note: 'Decision recorded' },
      { at: '2026-11-08T12:00:00Z', actor: 'Risk Analyst A', from: 'open', to: 'review', note: 'Quantity check done, ready for review' },
    ],
  },
]

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
  const [audit, setAudit] = useState<AuditEntry[]>([
    { at: '2026-11-07T09:30:00Z', actor: 'Risk Analyst B', event: 'assumption.approved', ref: 'AS-T-1', detail: '60% affected share approved' },
  ])

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
