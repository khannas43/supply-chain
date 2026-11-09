// Builds backend/seed/demo.json (rows per table, in foreign-key order) from the frontend demo data.
// Run from frontend/: node scripts/export-seed.mjs
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const tmp = mkdtempSync(join(tmpdir(), 'seed-'))
const bundle = join(tmp, 'seed.mjs')
await build({
  entryPoints: [resolve('scripts/seed-entry.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: bundle,
  logLevel: 'error',
})
const d = await import(pathToFileURL(bundle).href)

const nul = (v) => (v === undefined ? null : v)
const t = {}

t.person = d.IDENTITIES.map((i) => ({ id: i.id, name: i.name, roles: [i.role], source: 'demo', last_seen: null }))

t.country = d.countries.map((c) => ({ code: c.code, name: c.name }))
t.country_alias = d.countries.flatMap((c) => c.aliases.map((a) => ({ alias: a, country_code: c.code })))
t.commodity_form = d.forms.map((f) => ({ commodity: f.commodity, form: f.form, note: f.note }))
t.unit_conversion = d.seedConversions.map((c) => ({
  id: c.id, from_unit: c.from, to_unit: c.to, factor: c.factor, effective_from: c.effectiveFrom, source: c.source,
}))

t.source = d.seedSources.map((s) => ({
  id: s.id, name: s.name, mode: s.mode, enabled: s.enabled, last_attempt: s.lastAttempt,
  last_usable: s.lastUsable, policy_hours: s.policyHours, last_error: nul(s.lastError),
}))
t.source_commodity = d.seedSources.flatMap((s) => s.commodities.map((c) => ({ source_id: s.id, commodity: c })))

t.rule = d.seedRules.map((r) => ({ id: r.id, name: r.name, commodity: r.commodity }))
t.rule_version = d.seedRules.flatMap((r) =>
  r.versions.map((v) => ({
    rule_id: r.id, v: v.v, status: v.status, thresholds: v.thresholds, created_by: v.createdBy,
    created_at: v.createdAt, published_by: nul(v.publishedBy), published_at: nul(v.publishedAt),
  })),
)

// The alert's rule is stored as "name vX.Y"; resolve it to a rule_version row.
const ruleOf = (label) => {
  const m = label.match(/^(.*) v(\d+\.\d+)$/)
  const rule = d.seedRules.find((r) => r.name === m[1])
  if (!rule || !rule.versions.some((v) => v.v === m[2])) throw new Error(`No rule version for "${label}"`)
  return { rule_id: rule.id, rule_v: m[2] }
}

t.evidence = d.alerts.map((a) => ({
  id: `EV-${a.id}`, source: a.evidence.source, object_key: a.evidence.objectKey, sha256: a.evidence.sha256,
  published_at: a.evidence.publishedAt, ingested_at: a.evidence.ingestedAt, mode: a.mode, scenario_run: nul(a.scenarioRun),
}))

t.node = d.nodes.map((n) => ({
  id: n.id, commodity: n.commodity, name: n.name, kind: n.kind, tier: nul(n.tier), country: n.country, site: nul(n.site),
}))
t.supply_edge = d.edges.map((e) => ({
  id: e.id, from_node: e.from, to_node: e.to, material: e.material, source: e.source, confidence: e.confidence,
  effective_from: e.effectiveFrom, effective_to: null, uncertain: !!e.uncertain, note: nul(e.note),
}))

t.alert = d.alerts.map((a) => ({
  id: a.id, commodity: a.commodity, title: a.title, summary: a.summary, location: a.location,
  severity: a.severity, confidence: a.confidence, observed_at: a.observedAt, mode: a.mode,
  scenario_run: nul(a.scenarioRun), assessment_status: a.assessmentStatus, disposition: a.disposition,
  ...ruleOf(a.ruleVersion), rule_inputs: a.ruleInputs, evidence_id: `EV-${a.id}`,
}))
t.alert_exposed_node = d.alerts.flatMap((a) => a.exposedNodeIds.map((n, i) => ({ alert_id: a.id, node_id: n, position: i })))

t.response_option = d.options.map((o) => ({
  id: o.id, alert_id: o.alertId, type: o.type, name: o.name, qualification: o.qualification, spec_fit: o.specFit,
  capacity: o.capacity, unit_price: nul(o.unitPrice), quantity_available: nul(o.quantityAvailable),
  lead_time_days: o.leadTimeDays, quote_valid_until: nul(o.quoteValidUntil), note: o.note,
}))

t.assumption = d.initialAssumptions.map((a) => ({
  id: a.id, alert_id: a.alertId, affected_share_pct: a.affectedSharePct, basis: a.basis,
  proposed_by_id: a.proposedBy.id, proposed_by_name: a.proposedBy.name, proposed_at: a.proposedAt, status: a.status,
  decided_by_id: nul(a.decidedBy?.id), decided_by_name: nul(a.decidedBy?.name), decided_at: nul(a.decidedAt),
  decision_note: nul(a.decisionNote),
}))

// One immutable assessment snapshot per version. The assumption a version rests on is named in its note.
t.assessment = Object.entries(d.initialVersions).flatMap(([alertId, versions]) => {
  const b = d.assessmentBase[alertId]
  return versions.map((v) => ({
    alert_id: alertId, version: v.v, created_at: v.at, note: v.note, calc_version: b.calcVersion,
    assumption_id: v.note.match(/AS-[A-Z]-\d+/)?.[0] ?? null,
    exposed_value: b.exposed.value, exposed_unit: b.exposed.unit, exposed_horizon: b.exposed.horizon,
    reference_option_id: b.referenceOptionId, inputs: b.inputs, paths: b.paths, missing: b.missing,
  }))
})

t.action = d.seedActions.map((a) => ({
  id: a.id, alert_id: a.alertId, commodity: a.commodity, option_id: a.optionId, owner_id: a.ownerId,
  owner_name: a.ownerName, target_date: a.targetDate, rationale: a.rationale, status: a.status,
  created_at: a.createdAt, created_by: a.createdBy, assessment_version: a.assessmentVersion,
  assumption_status: a.assumptionStatus,
}))
t.action_status_history = d.seedActions.flatMap((a) =>
  a.history.map((h) => ({ action_id: a.id, at: h.at, actor: h.actor, from_status: nul(h.from), to_status: h.to, note: h.note })),
)
t.audit_event = d.seedAudit.map((e) => ({ at: e.at, actor: e.actor, event: e.event, ref: e.ref, detail: e.detail }))

t.ingestion_run = d.seedRuns.map((r) => ({
  id: r.id, source_id: r.sourceId, started_at: r.startedAt, status: r.status, accepted: r.accepted,
  duplicate: r.duplicate, quarantined: r.quarantined, note: r.note,
}))
t.quarantine_item = d.seedQuarantine.map((q) => ({
  id: q.id, source_id: q.sourceId, run_id: q.runId, received_at: q.receivedAt, reason: q.reason, source_row: q.sourceRow,
  object_key: q.objectKey, field: q.field, bad_value: q.badValue, status: q.status, correction: nul(q.correction),
}))
t.dead_letter = d.seedDead.map((x) => ({
  id: x.id, source_id: x.sourceId, received_at: x.receivedAt, reason: x.reason, object_key: x.objectKey, attempts: x.attempts,
}))

const out = resolve('../backend/seed/demo.json')
writeFileSync(out, JSON.stringify(t, null, 2) + '\n')
console.log(`wrote ${out}`)
for (const [k, v] of Object.entries(t)) console.log(`  ${k}: ${v.length}`)
