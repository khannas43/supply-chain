import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { PageHead, formatTime } from '../components/ui'
import { DIMS, compare, fmtDate, usd } from '../prototype/data'
import { buildPack, editDraft, issuePack, recordReview, resetDecision, submitForReview, useDecision, type IssuedPack, type PackData } from '../prototype/pack'
import { RagBadge, RepresentativeBadge } from '../prototype/parts'
import { useQuotes } from '../prototype/quotes'
import { useSelection } from '../prototype/selection'
import type { Rating } from '../prototype/data'

const rating = (r: string) => r as Rating

function csvOf(p: PackData, version?: number) {
  const q = (x: string | number) => `"${String(x).replace(/"/g, '""')}"`
  const lines: string[] = []
  lines.push(['Decision pack', version ? `version ${version}` : 'preview', p.generatedAt].map(q).join(','))
  lines.push(['Requirement', `${p.requirement.volumeT} t ${p.requirement.form} ${p.requirement.grade}`, p.requirement.timeframe, p.requirement.delivery].map(q).join(','))
  lines.push(['Recommended', p.recommendation.name, p.recommendation.rationale].map(q).join(','))
  lines.push('')
  lines.push(['Rank', 'Supplier', 'Overall', ...DIMS.map((d) => d.label), 'Total landed cost (USD)', 'Price basis'].map(q).join(','))
  p.ranked.forEach((r) => lines.push([r.rank, r.name, r.overall.toFixed(2), ...DIMS.map((d) => r.dims[d.id].toFixed(2)), Math.round(r.total), r.indicative ? 'Indicative' : 'Quoted'].map(q).join(',')))
  lines.push('')
  lines.push(['Supplier considered', 'Status', 'Reason'].map(q).join(','))
  p.considered.forEach((c) => lines.push([c.name, c.status, c.reasons.join('; ')].map(q).join(',')))
  lines.push('')
  lines.push(['Weightings', ...DIMS.map((d) => `${d.short} ${p.weights[d.id]}%`)].map(q).join(','))
  return lines.join('\n')
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return <div style={{ marginTop: 16 }}><h3 style={{ margin: '0 0 6px' }}>{n}. {title}</h3>{children}</div>
}

export function PackView({ p }: { p: PackData }) {
  return (
    <div className="pack">
      <Section n={1} title="Summary and recommendation">
        <p style={{ margin: '0 0 6px' }}>Requirement: <strong>{p.requirement.volumeT} t of {p.requirement.form}</strong> ({p.requirement.grade}) over {p.requirement.timeframe}, delivered to {p.requirement.delivery}.</p>
        <p style={{ margin: '0 0 6px' }}>Recommended supplier: <strong>{p.recommendation.name}</strong>.</p>
        <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>{p.recommendation.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <p style={{ margin: 0 }}><em>Rationale recorded: </em>{p.recommendation.rationale}</p>
      </Section>

      <Section n={2} title="Suppliers considered">
        <div className="table-wrap"><table>
          <thead><tr><th>Supplier</th><th>Status</th><th>Reason</th><th>Total landed cost</th></tr></thead>
          <tbody>{p.considered.map((c) => (
            <tr key={c.id}><td>{c.name}<div className="muted small">{c.country}{c.emerging && ' · emerging'}</div></td>
              <td><span className={`badge ${c.status === 'Ranked' ? 'b-ok' : c.status === 'Excluded' ? 'b-bad' : 'b-warn'}`}>{c.status}</span></td>
              <td className="small">{c.reasons.length ? c.reasons.join('. ') : '–'}{c.missing.length > 0 && <div className="muted">Missing: {c.missing.join('; ')}</div>}</td>
              <td className="small">{usd(c.total)}{c.indicative && ' (indicative)'}</td></tr>
          ))}</tbody></table></div>
      </Section>

      <Section n={3} title="Scores and ratings">
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>Supplier</th><th>Overall</th>{DIMS.map((d) => <th key={d.id}>{d.short}</th>)}</tr></thead>
          <tbody>{p.ranked.map((r) => (
            <tr key={r.id}><td>{r.rank}</td><td>{r.name}</td><td><RagBadge rating={rating(r.overall < 2.5 ? 'green' : r.overall > 3.5 ? 'red' : 'amber')} score={r.overall} /></td>
              {DIMS.map((d) => <td key={d.id}><RagBadge rating={rating(r.ratings[d.id])} score={r.dims[d.id]} /></td>)}</tr>
          ))}</tbody></table></div>
      </Section>

      <Section n={4} title="Weightings used">
        <p style={{ margin: '0 0 4px' }}>{DIMS.map((d) => `${d.label} ${p.weights[d.id]}%`).join(' · ')}</p>
        {p.differsFromDefault
          ? <p className="muted small" style={{ margin: 0 }}>These differ from the defaults. Ranking under the default weightings: {p.defaultRanking.join(' › ') || 'none'}.</p>
          : <p className="muted small" style={{ margin: 0 }}>These are the default weightings.</p>}
      </Section>

      <Section n={5} title="Robustness">
        <div className="table-wrap"><table>
          <thead><tr><th>Case</th><th>Leading supplier</th><th>Result</th></tr></thead>
          <tbody>{p.robustness.map((r) => <tr key={r.label}><td>{r.label}</td><td>{r.leader ?? 'none ranked'}</td><td>{r.same ? 'Same leader' : 'Leader changes'}</td></tr>)}</tbody></table></div>
      </Section>

      <Section n={6} title="Landed-cost build-up">
        <div className="table-wrap"><table>
          <thead><tr><th>Supplier</th><th>Goods</th><th>Freight, insurance, handling</th><th>Duties and tariffs</th><th>Total</th><th>Per t WO₃</th><th>Basis</th></tr></thead>
          <tbody>{p.ranked.map((r) => (
            <tr key={r.id}><td>{r.name}</td><td>{usd(r.goods)}</td><td>{usd(r.freight)}</td><td>{usd(r.tariff)}</td><td><strong>{usd(r.total)}</strong></td><td>{usd(r.perTonneWo3)}</td>
              <td className="small">{r.indicative ? <span className="badge b-warn">Indicative</span> : <span className="badge b-ok">Quoted</span>} {r.costNote}</td></tr>
          ))}</tbody></table></div>
      </Section>

      <Section n={7} title="Detailed assessment of the three highest-ranked suppliers">
        {p.detail.map((d) => (
          <div key={d.name} style={{ marginBottom: 12 }}>
            <strong>{d.name}</strong> <span className="muted small">{d.country}</span>
            <div className="table-wrap"><table>
              <thead><tr><th>Metric</th><th>Score</th><th>Source</th><th>As of</th></tr></thead>
              <tbody>{d.metrics.map((m) => (
                <tr key={m.label}><td>{m.label}</td><td>{m.score == null ? <span className="badge b-neutral">Unknown</span> : <RagBadge rating={rating(m.rating)} score={m.score} />}</td>
                  <td className="small">{m.score == null ? '–' : m.source}{m.stale && ' (stale)'}<div className="muted">{m.score == null ? '' : m.licence}</div></td><td className="small">{m.score == null ? '–' : fmtDate(m.asOf)}</td></tr>
              ))}</tbody></table></div>
          </div>
        ))}
      </Section>

      <Section n={8} title="Evidence, assumptions and known gaps">
        <p className="small" style={{ margin: '0 0 6px' }}>{p.confidence}</p>
        <strong className="small">Assumptions</strong>
        <ul className="small" style={{ margin: '2px 0 8px', paddingLeft: 18 }}>{p.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
        <strong className="small">Known data gaps</strong>
        <ul className="small" style={{ margin: '2px 0 0', paddingLeft: 18 }}>{p.gaps.map((a) => <li key={a}>{a}</li>)}</ul>
      </Section>
    </div>
  )
}

export function Decision() {
  const { user } = useAuth()
  const { selected, requirement, weights, scenario, limit } = useSelection()
  const { version: qv } = useQuotes()
  const { draft, packs } = useDecision()
  const [viewing, setViewing] = useState<IssuedPack | null>(null)
  const [comment, setComment] = useState('')
  const overLimit = selected.length > limit

  const res = useMemo(() => compare(overLimit ? [] : selected, weights, requirement), [selected, weights, requirement, overLimit, qv])
  const rankedIds = res.ranked.map((a) => a.supplier.id)
  const recId = draft.recommendId && rankedIds.includes(draft.recommendId) ? draft.recommendId : null
  const rationaleOk = draft.rationale.trim().length >= 10
  const preview = useMemo(() => (recId ? buildPack({ ids: selected, req: requirement, weights, scenario, recommendId: recId, rationale: draft.rationale }) : null), [recId, selected, requirement, weights, scenario, draft.rationale, qv])
  const confirmed = draft.review?.outcome === 'confirmed'
  const awaiting = draft.submitted && !draft.review
  const sameUser = draft.recordedBy === user.name
  const stale = draft.recommendId && !recId

  const status = confirmed ? ['b-ok', 'Reviewed and confirmed'] : draft.review?.outcome === 'returned' ? ['b-bad', 'Returned for changes'] : awaiting ? ['b-warn', 'Awaiting second-person review'] : ['b-neutral', 'Draft']

  return (
    <div className="page">
      <PageHead title="Decision & pack">
        Record the recommendation and rationale, have a second team member review it, then issue a versioned decision pack. An issued pack is never changed; re-running makes a new version.
      </PageHead>
      <div className="row"><RepresentativeBadge /><span className="muted small">Prototype. Pack format (PDF, Excel or both) is still to be confirmed; this version prints to PDF and downloads a CSV summary. Formal client approval and saved comparisons are Phase 2.</span></div>

      <section className="card">
        <header><h2>Recommendation</h2><span className={`badge ${status[0]}`}>{status[1]}</span></header>
        {overLimit && <div className="notice" role="alert">{selected.length} suppliers are selected but the limit is {limit}. <Link to="/requirement">Remove {selected.length - limit}</Link>.</div>}
        {rankedIds.length === 0 ? <div className="empty">No supplier is ranked yet. Check the <Link to="/comparison">comparison</Link>.</div> : (
          <>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div className="field">
                <label htmlFor="rec">Recommended supplier (ranked suppliers only)</label>
                <select id="rec" value={recId ?? ''} onChange={(e) => editDraft({ recommendId: e.target.value || null })}>
                  <option value="">Choose…</option>
                  {res.ranked.map((a, i) => <option key={a.supplier.id} value={a.supplier.id}>{i + 1}. {a.supplier.name} ({a.overall!.toFixed(1)})</option>)}
                </select>
              </div>
              {stale && <span className="bad-text small" role="alert">The earlier choice is no longer ranked. Choose again.</span>}
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label htmlFor="why">Rationale (at least a sentence)</label>
              <textarea id="why" rows={3} value={draft.rationale} onChange={(e) => editDraft({ rationale: e.target.value })} placeholder="Why this supplier, and what the buyer should watch." />
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn primary" onClick={() => submitForReview(user.name)} disabled={!recId || !rationaleOk || draft.submitted || confirmed}>Submit for review</button>
              {!recId || !rationaleOk ? <span className="muted small">Choose a supplier and write a rationale to submit.</span> : null}
              {draft.recordedBy && <span className="muted small">Recorded by {draft.recordedBy}{draft.recordedAt && `, ${formatTime(draft.recordedAt)}`}</span>}
            </div>
          </>
        )}
      </section>

      <section className="card">
        <header><h2>Second-person review</h2></header>
        {!draft.submitted && !draft.review && <p className="muted" style={{ margin: 0 }}>Submit the recommendation first. A different team member then reviews the comparison and the pack.</p>}
        {awaiting && (
          <>
            <p style={{ marginTop: 0 }}>Awaiting review of the recommendation by a second team member.</p>
            {sameUser
              ? <div className="notice info">You recorded this recommendation, so you cannot review it. Sign in as another team member (use the identity switch) to confirm or return it.</div>
              : (
                <>
                  <div className="field"><label htmlFor="rc">Review comment</label><textarea id="rc" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <button className="btn primary" onClick={() => { recordReview(user.name, 'confirmed', comment); setComment('') }}>Confirm the comparison and pack</button>
                    <button className="btn" onClick={() => { recordReview(user.name, 'returned', comment); setComment('') }} disabled={comment.trim() === ''} title={comment.trim() === '' ? 'Say what needs changing' : undefined}>Return for changes</button>
                  </div>
                </>
              )}
          </>
        )}
        {draft.review && (
          <p style={{ margin: 0 }}>
            <span className={`badge ${draft.review.outcome === 'confirmed' ? 'b-ok' : 'b-bad'}`}>{draft.review.outcome === 'confirmed' ? 'Confirmed' : 'Returned'}</span> by {draft.review.by}, {formatTime(draft.review.at)}.
            {draft.review.comment && <> “{draft.review.comment}”</>}
            {draft.review.outcome === 'returned' && ' Change the recommendation or rationale and submit again.'}
          </p>
        )}
      </section>

      <section className="card">
        <header><h2>Issue the pack</h2><span className="muted small">{packs.length} issued so far</span></header>
        <div className="row">
          <button className="btn primary" disabled={!confirmed || !preview} onClick={() => preview && issuePack(user.name, preview)}>Issue pack version {packs.length + 1}</button>
          {!confirmed && <span className="muted small">A pack can be issued only after the review is confirmed.</span>}
          <button className="btn" onClick={resetDecision} disabled={!draft.recommendId && !draft.rationale}>Start a new decision</button>
        </div>
        {packs.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Version</th><th>Issued</th><th>By</th><th>Reviewed by</th><th>Recommended</th><th /></tr></thead>
              <tbody>
                {[...packs].reverse().map((k) => (
                  <tr key={k.version}>
                    <td><strong>v{k.version}</strong></td><td>{formatTime(k.issuedAt)}</td><td>{k.issuedBy}</td><td>{k.reviewedBy}</td><td>{k.data.recommendation.name}</td>
                    <td className="row"><button className="btn" onClick={() => setViewing(k)}>Open</button>
                      <button className="btn" onClick={() => download(`decision-pack-v${k.version}.csv`, csvOf(k.data, k.version))}>CSV</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {viewing && (
        <section className="card" aria-label={`Issued pack version ${viewing.version}`}>
          <header>
            <h2>Issued pack v{viewing.version} <span className="badge b-ok">Issued, read-only</span></h2>
            <span className="row no-print"><button className="btn" onClick={() => window.print()}>Print or save as PDF</button><button className="btn" onClick={() => setViewing(null)}>Close</button></span>
          </header>
          <p className="muted small" style={{ marginTop: 0 }}>Issued {formatTime(viewing.issuedAt)} by {viewing.issuedBy}; reviewed by {viewing.reviewedBy}. This snapshot does not change when quotes or weightings change.</p>
          <PackView p={viewing.data} />
        </section>
      )}

      {preview && !viewing && (
        <section className="card">
          <header><h2>Pack preview</h2><span className="badge b-warn">Not issued</span></header>
          <PackView p={preview} />
        </section>
      )}
    </div>
  )
}
