import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useApi, useDebounced } from '../api/hooks'
import type { TraverseResult } from '../api/types'
import { useApp } from '../components/AppContext'
import { ConfidenceBadge, PageHead } from '../components/ui'
import type { Alert, NetNode } from '../data/types'

type Direction = 'upstream' | 'downstream' | 'both'

const defaultFocus = { wheat: 'w-rott', tungsten: 't-goslar' } as const

export function SupplierNetwork() {
  const { commodity } = useApp()
  const [params, setParams] = useSearchParams()
  const [direction, setDirection] = useState<Direction>('both')
  const [depth, setDepth] = useState(3)
  const [limit, setLimit] = useState(40)
  const [material, setMaterial] = useState('')
  const [selected, setSelected] = useState<{ type: 'node' | 'edge'; id: string } | null>(null)

  const nodesRemote = useApi<NetNode[]>(`/network/nodes?commodity=${commodity}`)
  const alertsRemote = useApi<Alert[]>(`/alerts?commodity=${commodity}`)
  const commodityNodes = (nodesRemote.data ?? []).filter((n) => n.commodity === commodity)

  const focusParam = params.get('focus')
  const focusId = commodityNodes.some((n) => n.id === focusParam) ? focusParam! : commodityNodes.some((n) => n.id === defaultFocus[commodity]) ? defaultFocus[commodity] : commodityNodes[0]?.id
  const alert = (alertsRemote.data ?? []).find((a) => a.id === params.get('alert') && a.commodity === commodity)
  const exposed = useMemo(() => new Set(alert?.exposedNodeIds ?? []), [alert])

  // the material box is typed into; ask the API once typing pauses
  const materialQuery = useDebounced(material.trim(), 300)
  const query = focusId
    ? `/network/traverse?focus=${encodeURIComponent(focusId)}&direction=${direction}&depth=${depth}&limit=${limit}${materialQuery ? `&material=${encodeURIComponent(materialQuery)}` : ''}`
    : null
  const traverse = useApi<TraverseResult>(query)
  const result = traverse.data && traverse.data.focus === focusId ? traverse.data : null

  // keep the selection from pointing at something that is no longer on screen
  useEffect(() => setSelected(null), [commodity, focusId])

  const cycles = useMemo(() => new Set(result?.cycleEdgeIds ?? []), [result])

  const flowNodes: Node[] = useMemo(() => {
    if (!result) return []
    const perLevel = new Map<number, number>()
    return result.nodes.map(({ node, level }) => {
      const row = perLevel.get(level) ?? 0
      perLevel.set(level, row + 1)
      const cls = ['rfnode', exposed.has(node.id) ? 'exposed' : '', node.id === focusId ? 'focus' : ''].join(' ')
      return {
        id: node.id,
        position: { x: level * 240, y: row * 100 },
        className: cls,
        data: {
          label: (
            <div>
              <strong>{node.name}</strong>
              <small>{node.tier ?? node.kind} · {node.country}</small>
            </div>
          ),
        },
        sourcePosition: 'right' as never,
        targetPosition: 'left' as never,
      }
    })
  }, [result, exposed, focusId])

  const flowEdges: Edge[] = useMemo(
    () =>
      (result?.edges ?? []).map((e) => {
        const cyc = cycles.has(e.id)
        const colour = cyc ? 'var(--warn)' : 'var(--muted)'
        return {
          id: e.id,
          source: e.from,
          target: e.to,
          label: cyc ? 'cycle' : e.uncertain ? 'uncertain' : undefined,
          style: { stroke: colour, strokeDasharray: e.uncertain || cyc ? '6 4' : undefined, strokeWidth: 1.6 },
          markerEnd: { type: MarkerType.ArrowClosed, color: colour },
        }
      }),
    [result, cycles],
  )

  const nodeName = (id: string) => commodityNodes.find((n) => n.id === id)?.name ?? id
  const selNode = selected?.type === 'node' ? result?.nodes.find((n) => n.node.id === selected.id)?.node : undefined
  const selEdge = selected?.type === 'edge' ? result?.edges.find((e) => e.id === selected.id) : undefined
  const relatedAlerts = selNode ? (alertsRemote.data ?? []).filter((a) => a.exposedNodeIds.includes(selNode.id)) : []
  const uncertainShown = result?.edges.filter((e) => e.uncertain).length ?? 0
  const error = nodesRemote.error ?? traverse.error ?? alertsRemote.error
  const retry = () => { nodesRemote.reload(); alertsRemote.reload(); traverse.reload() }

  return (
    <div className="page">
      <PageHead title="Supplier network">
        Upstream and downstream links around a supplier, with the source, date and confidence of each link. This view is read-only; changes arrive through import.
      </PageHead>

      {error && (
        <div className="notice" role="alert">{error} <button className="btn" onClick={retry}>Retry</button></div>
      )}

      {alert && (
        <div className="notice info">
          Highlighting suppliers exposed to <strong>{alert.title}</strong>. Geographic overlap is a candidate exposure, not proof of interruption.{' '}
          <button className="btn" onClick={() => { params.delete('alert'); setParams(params) }}>Clear</button>
        </div>
      )}

      <div className="row">
        <div className="field"><label htmlFor="n-focus">Focus supplier</label>
          <select id="n-focus" value={focusId ?? ''} onChange={(e) => { const p = new URLSearchParams(params); p.set('focus', e.target.value); setParams(p) }}>
            {commodityNodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select></div>
        <div className="field"><label htmlFor="n-dir">Direction</label>
          <select id="n-dir" value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
            <option value="both">Both</option><option value="upstream">Upstream</option><option value="downstream">Downstream</option>
          </select></div>
        <div className="field"><label htmlFor="n-depth">Depth</label>
          <select id="n-depth" value={depth} onChange={(e) => setDepth(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d} level{d > 1 ? 's' : ''}</option>)}
          </select></div>
        <div className="field"><label htmlFor="n-limit">Result limit</label>
          <select id="n-limit" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {[10, 25, 40, 60, 100].map((d) => <option key={d} value={d}>{d} nodes</option>)}
          </select></div>
        <div className="field"><label htmlFor="n-mat">Material filter</label>
          <input id="n-mat" value={material} onChange={(e) => setMaterial(e.target.value)} placeholder="e.g. concentrate" /></div>
      </div>

      <div className="row small" aria-live="polite">
        {result ? (
          <>
            <strong>Showing {result.nodes.length} of {result.totalReachable} reachable nodes</strong>
            {result.truncated && <span className="badge b-warn">Result limit reached, raise the limit or narrow the depth</span>}
            {result.cycleEdgeIds.length > 0 && <span className="badge b-warn">{result.cycleEdgeIds.length} cycle link{result.cycleEdgeIds.length > 1 ? 's' : ''} detected and not followed</span>}
            {uncertainShown > 0 && <span className="badge b-neutral">{uncertainShown} uncertain link{uncertainShown > 1 ? 's' : ''}</span>}
          </>
        ) : !error && <span className="muted">Loading network…</span>}
        {traverse.loading && result && <span className="muted">Updating…</span>}
      </div>

      <div className="split">
        <div className="net-wrap">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={(_, n) => setSelected({ type: 'node', id: n.id })}
            onEdgeClick={(_, e) => setSelected({ type: 'edge', id: e.id })}
            onPaneClick={() => setSelected(null)}
            proOptions={{ hideAttribution: true }}
            aria-label="Supplier network graph"
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        <aside className="detail" aria-live="polite">
          <section className="card">
            <header><h2>Details</h2></header>
            {!selected && <div className="muted">Select a supplier or a link. Upstream is on the left, downstream on the right.</div>}
            {selNode && (
              <>
                <dl className="kv">
                  <dt>Name</dt><dd>{selNode.name}</dd>
                  <dt>Type</dt><dd>{selNode.kind}{selNode.tier ? ` · ${selNode.tier}` : ''}</dd>
                  <dt>Country</dt><dd>{selNode.country}</dd>
                  <dt>Site</dt><dd>{selNode.site ?? <span className="muted">not recorded</span>}</dd>
                </dl>
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => { const p = new URLSearchParams(params); p.set('focus', selNode.id); setParams(p) }}>Centre on this</button>
                </div>
                <h3 style={{ marginTop: 14 }}>Alerts affecting this node</h3>
                {relatedAlerts.length === 0 ? <div className="muted small">None matched.</div> : relatedAlerts.map((a) => (
                  <div key={a.id}><Link to={`/risk?alert=${a.id}`}>{a.title}</Link></div>
                ))}
              </>
            )}
            {selEdge && (
              <dl className="kv">
                <dt>From</dt><dd>{nodeName(selEdge.from)}</dd>
                <dt>To</dt><dd>{nodeName(selEdge.to)}</dd>
                <dt>Material</dt><dd>{selEdge.material}</dd>
                <dt>Source</dt><dd>{selEdge.source}</dd>
                <dt>Effective</dt><dd>{selEdge.effectiveFrom}</dd>
                <dt>Confidence</dt><dd><ConfidenceBadge value={selEdge.confidence} /></dd>
                {selEdge.note && (<><dt>Note</dt><dd>{selEdge.note}</dd></>)}
                {cycles.has(selEdge.id) && (<><dt>Cycle</dt><dd>This link returns to a supplier already on the path and is not followed.</dd></>)}
              </dl>
            )}
          </section>
          <div className="legend">
            <span><span className="dot" style={{ background: 'var(--accent)' }} />Focus</span>
            <span><span className="dot" style={{ background: 'var(--bad)' }} />Exposed to alert</span>
            <span>Dashed link = uncertain or cycle</span>
          </div>
        </aside>
      </div>
    </div>
  )
}
