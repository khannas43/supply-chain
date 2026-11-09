import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useStore } from './store'
import {
  nextMinor, seedConversions, seedDead, seedQuarantine, seedRules, seedRuns, seedSources,
  type Conversion, type DeadRow, type QuarantineRow, type Rule, type RunRow, type SourceRow, type Threshold,
} from './pipeline'

export interface ImportRecord { id: string; dataset: string; rows: number; rejected: number; checksum: string; version: number; by: string; at: string }

export type FailureKind = 'rate_limit' | 'timeout' | 'duplicate' | 'late' | 'malformed' | 'missing_field' | 'recover'

export interface SimLogEntry { at: string; runId: string; text: string }
export interface SimState {
  scenarioId: string | null
  runId: string | null
  status: 'idle' | 'running' | 'paused'
  seed: number
  offsetHours: number
  emitted: number
  log: SimLogEntry[]
}

export const START = '2026-11-07T08:00:00Z'
export const SCENARIOS = [
  { id: 'SC-W-1', name: 'Wheat policy and logistics event', commodity: 'wheat', seed: 4711, events: [
    { at: 0, text: 'Policy announcement: export restriction, Country A (simulated)' },
    { at: 6, text: 'Logistics report: port congestion, Country B corridor (simulated)' },
    { at: 30, text: 'Policy clarification published; scope unchanged (simulated)' },
  ] },
  { id: 'SC-T-1', name: 'Tungsten export-policy event', commodity: 'tungsten', seed: 1042, events: [
    { at: 0, text: 'Policy announcement: export licence tightening, Country T (simulated)' },
    { at: 12, text: 'Price series update: concentrate above threshold (simulated)' },
    { at: 36, text: 'Licence quota notice, Country T (simulated)' },
  ] },
] as const

const idle: SimState = { scenarioId: null, runId: null, status: 'idle', seed: 0, offsetHours: 0, emitted: 0, log: [] }

interface Pipeline {
  sources: SourceRow[]
  toggleSource: (id: string) => void
  runs: RunRow[]
  quarantine: QuarantineRow[]
  dead: DeadRow[]
  requestReplay: (id: string, correction: string) => void
  rules: Rule[]
  saveDraft: (ruleId: string, thresholds: Threshold[]) => void
  publish: (ruleId: string, v: string) => void
  imports: ImportRecord[]
  commitImport: (rec: Omit<ImportRecord, 'id' | 'version' | 'by' | 'at'>, rejected: { reason: string; row: string; field: string; bad: string }[]) => ImportRecord
  conversions: Conversion[]
  addConversion: (c: Omit<Conversion, 'id'>) => void
  sim: SimState
  startRun: (scenarioId: string) => void
  setPaused: (p: boolean) => void
  advance: (hours: number) => void
  resetRun: () => void
  inject: (k: FailureKind) => void
  simNow: () => string
}

const Ctx = createContext<Pipeline | null>(null)
const clockAt = (h: number) => new Date(Date.parse(START) + h * 3600000).toISOString()

export function PipelineProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { log } = useStore()
  const [sources, setSources] = useState(seedSources)
  const [runs, setRuns] = useState(seedRuns)
  const [quarantine, setQuarantine] = useState(seedQuarantine)
  const [dead] = useState(seedDead)
  const [rules, setRules] = useState(seedRules)
  const [imports, setImports] = useState<ImportRecord[]>([])
  const [conversions, setConversions] = useState(seedConversions)
  const [sim, setSim] = useState<SimState>(idle)

  const value = useMemo<Pipeline>(() => {
    const simNow = () => clockAt(sim.offsetHours)
    const addRun = (r: Omit<RunRow, 'id' | 'startedAt'>) =>
      setRuns((cur) => [{ ...r, id: `RUN-${String(117 + cur.length - seedRuns.length).padStart(4, '0')}`, startedAt: sim.status === 'idle' ? new Date().toISOString() : simNow() }, ...cur])
    const addLog = (text: string, s: SimState = sim) => ({ at: clockAt(s.offsetHours), runId: s.runId ?? '', text })

    return {
      sources,
      toggleSource: (id) => {
        const s = sources.find((x) => x.id === id)!
        setSources((cur) => cur.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)))
        log(s.enabled ? 'source.paused' : 'source.enabled', id, s.name)
      },
      runs,
      quarantine,
      dead,
      requestReplay: (id, correction) => {
        setQuarantine((cur) => cur.map((q) => (q.id === id ? { ...q, status: 'replay_requested', correction } : q)))
        log('quarantine.replay_requested', id, `corrected value: ${correction || '(none)'}`)
      },
      rules,
      saveDraft: (ruleId, thresholds) => {
        setRules((cur) => cur.map((r) => {
          if (r.id !== ruleId) return r
          const last = r.versions[r.versions.length - 1]
          const now = new Date().toISOString()
          if (last.status === 'draft') return { ...r, versions: [...r.versions.slice(0, -1), { ...last, thresholds, createdBy: user.name, createdAt: now }] }
          return { ...r, versions: [...r.versions, { v: nextMinor(last.v), status: 'draft', thresholds, createdBy: user.name, createdAt: now }] }
        }))
        log('rule.draft', ruleId, 'thresholds changed')
      },
      publish: (ruleId, v) => {
        const now = new Date().toISOString()
        setRules((cur) => cur.map((r) => r.id !== ruleId ? r : { ...r, versions: r.versions.map((x) => x.v === v ? { ...x, status: 'published', publishedBy: user.name, publishedAt: now } : x.status === 'published' ? { ...x, status: 'superseded' } : x) }))
        log('rule.published', ruleId, `version ${v}`)
      },
      imports,
      commitImport: (rec, rejected) => {
        const version = imports.filter((i) => i.dataset === rec.dataset).length + 1
        const full: ImportRecord = { ...rec, id: `IMP-${String(imports.length + 1).padStart(3, '0')}`, version, by: user.name, at: new Date().toISOString() }
        setImports((cur) => [full, ...cur])
        if (rejected.length) {
          setQuarantine((cur) => [
            ...rejected.map((r, i) => ({ id: `Q-${String(33 + cur.length + i).padStart(4, '0')}`, sourceId: 'src-import', runId: full.id, receivedAt: full.at, reason: r.reason, sourceRow: r.row, objectKey: `evidence/import/${full.id}.csv`, field: r.field, badValue: r.bad, status: 'quarantined' as const })),
            ...cur,
          ])
        }
        log('import.committed', full.id, `${rec.dataset} v${version}: ${rec.rows} accepted, ${rec.rejected} quarantined`)
        return full
      },
      conversions,
      addConversion: (c) => {
        setConversions((cur) => [...cur, { ...c, id: `CV-${cur.length + 1}` }])
        log('reference.conversion_added', c.from + '->' + c.to, `factor ${c.factor} from ${c.effectiveFrom}`)
      },
      sim,
      simNow,
      startRun: (scenarioId) => {
        const sc = SCENARIOS.find((s) => s.id === scenarioId)!
        const runId = `run-${String(Math.floor(sc.seed % 1000)).padStart(4, '0')}-${Date.now().toString().slice(-4)}`
        const first = sc.events.filter((e) => e.at === 0)
        const next: SimState = { scenarioId, runId, status: 'running', seed: sc.seed, offsetHours: 0, emitted: first.length, log: [] }
        next.log = first.map((e) => addLog(e.text, next))
        setSim(next)
        addRun({ sourceId: 'src-policy', status: 'ok', accepted: first.length, duplicate: 0, quarantined: 0, note: `Simulator ${runId}` })
        log('simulator.started', runId, sc.name)
      },
      setPaused: (p) => {
        setSim((s) => ({ ...s, status: p ? 'paused' : 'running' }))
        log(p ? 'simulator.paused' : 'simulator.resumed', sim.runId ?? '', '')
      },
      advance: (hours) => {
        const sc = SCENARIOS.find((s) => s.id === sim.scenarioId)!
        const offset = sim.offsetHours + hours
        const due = sc.events.filter((e) => e.at > sim.offsetHours && e.at <= offset)
        setSim((s) => ({ ...s, offsetHours: offset, emitted: s.emitted + due.length, log: [...s.log, ...due.map((e) => ({ at: clockAt(offset), runId: s.runId ?? '', text: e.text })), ...(due.length ? [] : [{ at: clockAt(offset), runId: s.runId ?? '', text: `Clock advanced ${hours} h, no scheduled events` }])] }))
        if (due.length) addRun({ sourceId: 'src-policy', status: 'ok', accepted: due.length, duplicate: 0, quarantined: 0, note: `Simulator ${sim.runId}` })
      },
      resetRun: () => {
        log('simulator.reset', sim.runId ?? '', 'run state cleared; decisions and actions untouched')
        setSim(idle)
      },
      inject: (k) => {
        const when = simNow()
        const L = (text: string) => setSim((s) => ({ ...s, log: [...s.log, { at: when, runId: s.runId ?? '', text }] }))
        const mk = (n: number): QuarantineRow => ({ id: `Q-${String(40 + quarantine.length + n).padStart(4, '0')}`, sourceId: 'src-policy', runId: sim.runId ?? '', receivedAt: when, reason: '', sourceRow: `row 1 of injected-${sim.runId}.json`, objectKey: `evidence/sim/${sim.runId}/injected.json`, field: '', badValue: '', status: 'quarantined' })
        switch (k) {
          case 'rate_limit':
            L('Injected HTTP 429 with retry hint 30 s; collection retried after backoff')
            addRun({ sourceId: 'src-policy', status: 'ok', accepted: 0, duplicate: 0, quarantined: 0, note: 'HTTP 429, retried after backoff' })
            break
          case 'timeout':
            L('Injected source timeout; logistics feed marked failing, last usable data kept')
            setSources((cur) => cur.map((s) => (s.id === 'src-logistics' ? { ...s, lastAttempt: when, lastError: 'Timeout after 30 s' } : s)))
            addRun({ sourceId: 'src-logistics', status: 'failed', accepted: 0, duplicate: 0, quarantined: 0, note: 'Timeout after 30 s' })
            break
          case 'recover':
            L('Source recovered; logistics feed collected again')
            setSources((cur) => cur.map((s) => (s.id === 'src-logistics' ? { ...s, lastAttempt: when, lastUsable: when, lastError: undefined } : s)))
            addRun({ sourceId: 'src-logistics', status: 'ok', accepted: 4, duplicate: 0, quarantined: 0, note: 'Recovered after outage' })
            break
          case 'duplicate':
            L('Injected duplicate delivery; same record received twice, one alert only')
            addRun({ sourceId: 'src-policy', status: 'ok', accepted: 0, duplicate: 1, quarantined: 0, note: 'Duplicate delivery ignored' })
            break
          case 'late':
            L('Injected out-of-order observation; kept as history, current value not overwritten')
            addRun({ sourceId: 'src-policy', status: 'ok', accepted: 1, duplicate: 0, quarantined: 0, note: 'Late record retained as history' })
            break
          case 'malformed':
            L('Injected malformed payload; record sent to quarantine')
            setQuarantine((cur) => [{ ...mk(0), reason: 'Payload is not valid JSON', field: '(whole record)', badValue: '{"country": "A", ' }, ...cur])
            addRun({ sourceId: 'src-policy', status: 'partial', accepted: 0, duplicate: 0, quarantined: 1, note: 'Malformed payload' })
            break
          case 'missing_field':
            L('Injected record with a missing required field; record sent to quarantine')
            setQuarantine((cur) => [{ ...mk(0), reason: 'Missing required field: country', field: 'country', badValue: '' }, ...cur])
            addRun({ sourceId: 'src-policy', status: 'partial', accepted: 0, duplicate: 0, quarantined: 1, note: 'Missing required field' })
            break
        }
        log('simulator.inject', sim.runId ?? '', k)
      },
    }
  }, [sources, runs, quarantine, dead, rules, imports, conversions, sim, user.name, log])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePipeline() {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePipeline outside PipelineProvider')
  return v
}
