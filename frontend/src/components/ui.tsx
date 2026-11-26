import type { AssessmentStatus, Confidence, Disposition, Mode, Severity } from '../data/types'

const MODE: Record<Mode, [string, string]> = {
  live: ['b-live', 'Live'],
  replay: ['b-replay', 'Replay'],
  simulated: ['b-sim', 'Simulated'],
}
export const ModeBadge = ({ mode }: { mode: Mode }) => (
  <span className={`badge ${MODE[mode][0]}`} title="Data mode">{MODE[mode][1]}</span>
)

export const SeverityBadge = ({ value }: { value: Severity }) => (
  <span className={`badge b-${value}`} title="Severity">{value[0].toUpperCase() + value.slice(1)}</span>
)

export const ConfidenceBadge = ({ value }: { value: Confidence }) => (
  <span className="badge b-neutral" title="Evidence confidence">{value} confidence</span>
)

const ASSESS: Record<AssessmentStatus, [string, string]> = {
  unassessed: ['b-neutral', 'Unassessed'],
  partial: ['b-warn', 'Partial'],
  complete: ['b-ok', 'Complete'],
  awaiting_validation: ['b-warn', 'Awaiting validation'],
}
export const AssessmentBadge = ({ value }: { value: AssessmentStatus }) => (
  <span className={`badge ${ASSESS[value][0]}`}>{ASSESS[value][1]}</span>
)

const DISP: Record<Disposition, [string, string]> = {
  new: ['b-neutral', 'New'],
  confirmed: ['b-bad', 'Confirmed'],
  monitor: ['b-warn', 'Monitor'],
  dismissed: ['b-neutral', 'Dismissed'],
}
export const DispositionBadge = ({ value }: { value: Disposition }) => (
  <span className={`badge ${DISP[value][0]}`}>{DISP[value][1]}</span>
)

export function formatTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
}

export function PageHead({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} aria-pressed={value === t.id} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

export const STATE_BADGE = {
  fresh: ['b-ok', 'Fresh'],
  stale: ['b-warn', 'Stale'],
  failing: ['b-bad', 'Failing'],
  paused: ['b-neutral', 'Paused'],
} as const

export const STALENESS_BADGE: Record<string, [string, string]> = {
  fresh: ['b-ok', 'Fresh'], stale: ['b-warn', 'Stale'], unknown: ['b-warn', 'Freshness unknown'],
}
export const COMPLETENESS_BADGE: Record<string, [string, string]> = {
  complete: ['b-ok', 'Complete'], partial: ['b-warn', 'Partial'], estimated: ['b-warn', 'Estimated'], absent: ['b-bad', 'No data'],
}
export const LICENCE_LABEL: Record<string, string> = {
  public_domain: 'Public domain', public_notice: 'Public notice', public_filings: 'Public filings', attribution_required: 'Attribution required',
}

export const StalenessBadge = ({ value }: { value: string | null }) =>
  value ? <span className={`badge ${STALENESS_BADGE[value]?.[0] ?? 'b-warn'}`} title="Staleness, as reported by the provider">{STALENESS_BADGE[value]?.[1] ?? value}</span> : null

export const CompletenessBadge = ({ value }: { value: string | null }) =>
  value ? <span className={`badge ${COMPLETENESS_BADGE[value]?.[0] ?? 'b-warn'}`} title="How complete the underlying data is">{COMPLETENESS_BADGE[value]?.[1] ?? value}</span> : null
