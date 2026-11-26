import { useEffect } from 'react'
import {
  CONFIG, DIMS, METRICS, RATING_LABEL, dimensionScore, qualFor, fmtDate, isEmerging, landedCost, metricScore, ratingOf, usd,
  type Dim, type Qualification, type Rating, type Rmi, type Sanctions, type Supplier,
} from './data'
import { useSelection } from './selection'

// Rating is always text as well as colour, so it does not rely on colour alone.
export const RagBadge = ({ rating, score }: { rating: Rating; score?: number | null }) => (
  <span className={`rag rag-${rating}`} title={score != null ? `Score ${score.toFixed(1)} (1 = most favourable)` : undefined}>
    {RATING_LABEL[rating]}{score != null ? ` ${score.toFixed(1)}` : ''}
  </span>
)

export const RepresentativeBadge = () => <span className="badge b-sim" title="Invented data shaped like the Credibl and client inputs">Representative</span>

const QUAL: Record<Qualification, [string, string]> = {
  qualified: ['b-ok', 'Qualified'], pending: ['b-warn', 'Pending'], not_qualified: ['b-bad', 'Not qualified'], unknown: ['b-neutral', 'Unknown'],
}
export const QualBadge = ({ value }: { value: Qualification }) => <span className={`badge ${QUAL[value][0]}`}>{QUAL[value][1]}</span>

const SANC: Record<Sanctions, [string, string]> = { clear: ['b-ok', 'Clear'], review: ['b-warn', 'Review'], match: ['b-bad', 'Match'] }
export const SanctionsBadge = ({ value }: { value: Sanctions }) => <span className={`badge ${SANC[value][0]}`} title="Named-entity screening only; ownership is not screened">{SANC[value][1]}</span>

const RMI: Record<Rmi, string> = { conformant: 'RMI conformant', not_conformant: 'Not on RMI list', unknown: 'RMI unknown', na: 'Not a smelter' }
export const rmiLabel = (r: Rmi) => RMI[r]

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="drawer-back" onClick={onClose} />
      <aside className="drawer wide" role="dialog" aria-label={title}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="btn" onClick={onClose} autoFocus>Close</button>
        </div>
        {children}
      </aside>
    </>
  )
}

export function MetricTable({ s, dim }: { s: Supplier; dim?: Dim }) {
  const rows = METRICS.filter((m) => !dim || m.dim === dim)
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Metric</th><th>Score</th><th>Source and date</th></tr></thead>
        <tbody>
          {rows.map((m) => {
            const v = metricScore(s, m.id)
            return (
              <tr key={m.id}>
                <td>{m.label}<div className="muted small">{m.product}</div></td>
                <td>{v == null ? <span className="badge b-neutral">Unknown</span> : <RagBadge rating={ratingOf(v)} score={v} />}</td>
                <td className="small">
                  {v == null ? <span className="muted">No data. A missing value is never treated as a good score.</span> : (
                    <>
                      {m.source}<br />
                      <span className="muted">As of {fmtDate(m.asOf)}, refreshed {fmtDate(m.refreshed)}</span>
                      {m.stale && <> <span className="badge b-warn">Stale</span></>}
                      <br /><span className="muted">{m.licence}</span>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function CostBuildUp({ s }: { s: Supplier }) {
  const { requirement } = useSelection()
  const lc = landedCost(s, requirement.volumeT)
  return (
    <div className="card">
      <header><h2>Landed cost build-up</h2>{lc.indicative ? <span className="badge b-warn">Indicative</span> : <span className="badge b-ok">Quoted</span>}</header>
      <dl className="kv" style={{ gridTemplateColumns: '200px 1fr' }}>
        <dt>Goods</dt><dd>{usd(lc.goods)}</dd>
        <dt>Freight, insurance, handling</dt><dd>{usd(lc.freight)}</dd>
        <dt>Duties and tariffs</dt><dd>{usd(lc.tariff)}{lc.indicative && ' (not estimated)'}</dd>
        <dt><strong>Total landed cost</strong></dt><dd><strong>{usd(lc.total)}</strong></dd>
        <dt>Per tonne contained WO₃</dt><dd>{usd(lc.perTonneWo3)} <span className="muted small">at {CONFIG.contentWo3 * 100}% WO₃ in APT</span></dd>
      </dl>
      <p className="muted small" style={{ marginBottom: 0 }}>{lc.note} Costs not supplied, such as financing or storage, are not estimated.</p>
    </div>
  )
}

// Supplier profile (S04) when no dimension is given; evidence for one dimension when it is (S03 drill-down).
export function SupplierDrawer({ s, dim, onClose }: { s: Supplier; dim?: Dim; onClose: () => void }) {
  const { requirement } = useSelection()
  const d = dim ? DIMS.find((x) => x.id === dim)! : null
  const score = dim ? dimensionScore(s, dim, requirement.volumeT) : null
  return (
    <Drawer title={d ? `${s.name}: ${d.label}` : s.name} onClose={onClose}>
      <div className="row"><RepresentativeBadge />{isEmerging(s) && <span className="badge b-live">Emerging supplier</span>}</div>
      {d && (
        <div className="row">
          <RagBadge rating={ratingOf(score)} score={score} />
          <span className="muted small">{dim === 'price' ? 'Landed cost against the reference price' : 'Average of the metrics below'}; 1 is most favourable.</span>
        </div>
      )}
      {(!dim || dim === 'price') && <CostBuildUp s={s} />}
      {dim !== 'price' && (
        <div className="card">
          <header><h2>{d ? 'Metric evidence' : 'Risk profile'}</h2></header>
          <MetricTable s={s} dim={dim} />
        </div>
      )}
      {!dim && (
        <div className="card">
          <header><h2>Supplier record</h2></header>
          <dl className="kv" style={{ gridTemplateColumns: '170px 1fr' }}>
            <dt>Country</dt><dd>{s.country}</dd>
            <dt>Asset</dt><dd>{s.assetType}, {s.stage.toLowerCase()}</dd>
            <dt>Capacity</dt><dd>{s.capacityT != null ? `${s.capacityT.toLocaleString('en-GB')} t APT-equivalent per year` : 'Not disclosed'}</dd>
            <dt>Product forms</dt><dd>{s.forms.join(', ')}</dd>
            <dt>Qualification ({requirement.form})</dt><dd><QualBadge value={qualFor(s, requirement.form)} /> <span className="muted small">to be confirmed by the client’s Engineering/Quality Lead</span></dd>
            <dt>Sanctions screening</dt><dd><SanctionsBadge value={s.sanctions} /> <span className="muted small">ownership: not screened</span></dd>
            <dt>RMI status</dt><dd>{rmiLabel(s.rmi)}</dd>
            {s.note && <><dt>Note</dt><dd>{s.note}</dd></>}
          </dl>
        </div>
      )}
    </Drawer>
  )
}
