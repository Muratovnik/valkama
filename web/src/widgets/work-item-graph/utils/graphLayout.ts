/**
 * What the graph view needs to draw a space: the geometry, the edge shape, the
 * zoom bounds, and which items are in scope.
 *
 * ELK computes the geometry; this adapter preserves the planning model and
 * passes its orthogonal routes to Vue Flow.
 */

import type { ELK, ElkNode, ElkPoint } from 'elkjs/lib/elk-api'

import {
  MARGIN,
  NODE_HEIGHT,
  NODE_WIDTH,
  rowOrder,
} from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import { readyIds } from '@/shared/api/planningModel.ts'
import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

/** The slice of the read model a graph draws: items and the links between them. */
export interface GraphSource {
  edges: PlanningEdge[]
  nodes: WorkItemBrief[]
}

export interface RoutedEdge extends PlanningEdge {
  points: ElkPoint[]
}

export interface GraphLayout {
  edges: RoutedEdge[]
  height: number
  isolatedCount: number
  nodes: PlacedNode[]
  ranks: number
  width: number
}

export type GraphLayoutEngine = Pick<ELK, 'layout'>

/** Keep the interaction floor low enough for wide spaces to fit without clipping. */
export const GRAPH_ZOOM_MIN = 0.01
export const GRAPH_ZOOM_MAX = 1.45

/** Vue Flow's built-in edge and marker contract for every dependency wire. */
export const GRAPH_EDGE_TYPE = 'routed' as const
export const GRAPH_EDGE_MARKER_SIZE = 14

export interface GraphFlowEdge {
  class: string[]
  data: { kind: PlanningEdge['kind']; points: ElkPoint[] }
  focusable: false
  id: string
  markerEnd: {
    color: string
    height: number
    type: 'arrowclosed'
    width: number
  }
  selectable: false
  source: string
  sourceHandle: 'source'
  sourcePosition: 'right'
  target: string
  targetHandle: 'target'
  targetPosition: 'left'
  type: typeof GRAPH_EDGE_TYPE
}

/** Options consumed by the Vue Flow camera after nodes are mounted. */
export interface GraphFitViewOptions {
  duration: number
  maxZoom: number
  padding: { bottom: `${number}px`; left: `${number}px`; right: `${number}px`; top: `${number}px` }
}

/**
 * The air a framing leaves round the work. The key and the camera controls
 * stand in strips of their own above and below the flow, so a framing has no
 * chrome to keep clear: the whole flow is field.
 */
export const FRAME_GAP = 16

export function graphFitViewOptions(): GraphFitViewOptions {
  return {
    padding: {
      top: `${FRAME_GAP}px`,
      bottom: `${FRAME_GAP}px`,
      left: `${FRAME_GAP * 2}px`,
      right: `${FRAME_GAP * 2}px`,
    },
    duration: 0,
    maxZoom: 1,
  }
}

/**
 * Convert one routed dependency into a Vue Flow edge descriptor.
 * The source and target are never swapped for layout convenience: Vue Flow
 * keeps native handles while the edge renders the layout engine's bend points.
 */
export function flowEdge(
  edge: RoutedEdge,
  options: { markerColor: string; lit?: boolean; recessed?: boolean },
): GraphFlowEdge {
  const lit = options.lit ?? false
  const recessed = options.recessed ?? false
  return {
    id: edgeKey(edge),
    source: edge.from,
    target: edge.to,
    sourceHandle: 'source',
    targetHandle: 'target',
    type: GRAPH_EDGE_TYPE,
    sourcePosition: 'right',
    targetPosition: 'left',
    markerEnd: {
      type: 'arrowclosed',
      width: GRAPH_EDGE_MARKER_SIZE,
      height: GRAPH_EDGE_MARKER_SIZE,
      color: options.markerColor,
    },
    selectable: false,
    focusable: false,
    class: ['graph-edge', edge.kind, ...(lit ? ['lit'] : []), ...(recessed ? ['recessed'] : [])],
    data: { kind: edge.kind, points: edge.points },
  }
}

/**
 * Which slice of the space the graph draws. `chain` is one chain of work: its
 * root (in `epicId`) and the members the chain endpoint named, nothing else.
 */
export interface GraphScope {
  epicId: string | null
  kind: 'all' | 'chain' | 'epic' | 'none'
  /** The chain's member ids; read only in chain scope. */
  members?: readonly string[]
}

const WHOLE_SPACE: GraphScope = { kind: 'all', epicId: null }

function inScope(node: WorkItemBrief, scope: GraphScope): boolean {
  if (scope.kind === 'epic') return node.parent_id === scope.epicId
  if (scope.kind === 'none') return node.parent_id === null
  return true
}

/**
 * The part of a chain the graph draws: its root, its open members, and every
 * member that is the parent of another member — the epics the chain's work was
 * filed under — so an origin epic stays on the field even once it and all of
 * its work closed. Closed work is most of a chain that has run for a while —
 * four in five, in one that started this — and laying it all out cost seconds
 * and drew a field too small to read, so it is drawn only when asked for. The
 * root and the epics are drawn whatever their state: they are the chain's
 * shape, and without them the open work has nothing to stand on.
 */
function chainNodes(source: GraphSource, scope: GraphScope, showDone: boolean): WorkItemBrief[] {
  const chain = new Set([scope.epicId, ...(scope.members ?? [])])
  const members = source.nodes.filter((node) => chain.has(node.work_item_id))
  if (showDone) return members
  // Every in-chain ancestor of open work is some member's parent, so this one
  // set also keeps the epics open work is filed under, however deep.
  const parents = new Set(members.map((node) => node.parent_id))
  return members.filter(
    (node) =>
      node.work_item_id === scope.epicId ||
      !node.state.is_terminal ||
      parents.has(node.work_item_id),
  )
}

/**
 * The items the graph draws. A container is not work: it becomes the group chip
 * on its children, never a node. Container is the fact the server computed —
 * being somebody's parent — rather than the declared kind, so an ordinary task
 * that acquired children is grouped like one instead of drawn twice. Items in a
 * terminal state are archaeology and hidden unless asked for; in a healthy space
 * they outnumber open work. Terminal is asked of the workflow rather than
 * matched against a state named "done", so a renamed or a second closing state
 * still counts.
 *
 * A chain is the exception to the container rule: its root and its epics are
 * the shape of the chain, so they are drawn as nodes — see `chainNodes`.
 */
export function workNodes(
  source: GraphSource,
  showDone: boolean,
  scope: GraphScope = WHOLE_SPACE,
): WorkItemBrief[] {
  return scope.kind === 'chain'
    ? chainNodes(source, scope, showDone)
    : source.nodes.filter(
        (node) => !node.container && (showDone || !node.state.is_terminal) && inScope(node, scope),
      )
}

/**
 * The drawn items no drawn link touches. A parent is a chip on its children and
 * not a link, so an item related to nothing but its epic counts as unlinked: in
 * a real space those are most of the items, and laid out as a grid they push
 * the graph's actual structure off the screen.
 *
 * When nothing in view is linked there is no structure for them to crowd out,
 * so none is reported and the field draws every item rather than none.
 */
export function unlinkedIds(
  source: GraphSource,
  showDone: boolean,
  scope: GraphScope = WHOLE_SPACE,
): Set<string> {
  const drawn = workNodes(source, showDone, scope).map((node) => node.work_item_id)
  const present = new Set(drawn)
  const linked = new Set<string>()
  for (const edge of source.edges) {
    if (edge.kind === 'parent' || !present.has(edge.from) || !present.has(edge.to)) continue
    linked.add(edge.from)
    linked.add(edge.to)
  }
  return linked.size ? new Set(drawn.filter((id) => !linked.has(id))) : new Set<string>()
}

/**
 * How many finished items the "show done" control is currently hiding.
 *
 * Counted as what showing them would add rather than as the closed items in
 * scope: a chain draws a closed root or parent either way, and a count that
 * included those would promise nodes the control never adds.
 */
export function doneCount(source: GraphSource, scope: GraphScope = WHOLE_SPACE): number {
  return workNodes(source, true, scope).length - workNodes(source, false, scope).length
}

/** ELK owns ranking, cycle handling, component packing and obstacle routing. */
export async function layout(
  source: GraphSource,
  engine: GraphLayoutEngine,
  showDone = false,
  scope: GraphScope = WHOLE_SPACE,
): Promise<GraphLayout> {
  const nodes = workNodes(source, showDone, scope).sort(rowOrder)
  const present = new Set(nodes.map((node) => node.work_item_id))
  const visible = source.edges
    .filter((edge) => edge.kind !== 'parent' && present.has(edge.from) && present.has(edge.to))
    .sort((left, right) => edgeKey(left).localeCompare(edgeKey(right)))
  const connected = new Set(visible.flatMap((edge) => [edge.from, edge.to]))
  if (!nodes.length) {
    return {
      nodes: [],
      edges: [],
      width: MARGIN * 2,
      height: MARGIN * 2,
      ranks: 0,
      isolatedCount: 0,
    }
  }
  const graph: ElkNode = {
    id: 'work-graph',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': `[top=${MARGIN},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]`,
      'elk.spacing.nodeNode': '36',
      'elk.spacing.componentComponent': '48',
      'elk.layered.spacing.nodeNodeBetweenLayers': '64',
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.spacing.edgeNode': '20',
      'elk.spacing.edgeEdge': '12',
      'elk.aspectRatio': '1.7',
      'elk.separateConnectedComponents': 'true',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    },
    children: nodes.map((node) => ({
      id: node.work_item_id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      layoutOptions: { 'elk.portConstraints': 'FIXED_SIDE' },
      ports: visible.flatMap((edge) => [
        ...(edge.from === node.work_item_id
          ? [{ id: `${edgeKey(edge)}:out`, layoutOptions: { 'elk.port.side': 'EAST' } }]
          : []),
        ...(edge.to === node.work_item_id
          ? [{ id: `${edgeKey(edge)}:in`, layoutOptions: { 'elk.port.side': 'WEST' } }]
          : []),
      ]),
    })),
    edges: visible.map((edge) => ({
      id: edgeKey(edge),
      sources: [`${edgeKey(edge)}:out`],
      targets: [`${edgeKey(edge)}:in`],
    })),
  }
  const result = await engine.layout(graph)
  const positions = new Map(result.children?.map((node) => [node.id, node]))
  const routes = new Map(result.edges?.map((edge) => [edge.id, edge]))
  const placed = nodes.map((node) => {
    const position = positions.get(node.work_item_id)
    if (position?.x === undefined || position.y === undefined)
      throw new Error('Incomplete graph layout')
    return { ...node, x: position.x, y: position.y, isolated: !connected.has(node.work_item_id) }
  })
  const edges = visible.map((edge) => {
    const sections = routes.get(edgeKey(edge))?.sections
    if (!sections?.length) throw new Error('Incomplete graph route')
    return {
      ...edge,
      points: sections.flatMap((section) => [
        section.startPoint,
        ...(section.bendPoints ?? []),
        section.endPoint,
      ]),
    }
  })
  return {
    nodes: placed,
    edges,
    width: result.width ?? MARGIN * 2,
    height: result.height ?? MARGIN * 2,
    ranks: new Set(placed.filter((node) => !node.isolated).map((node) => node.x)).size,
    isolatedCount: placed.filter((node) => node.isolated).length,
  }
}

/** Items nothing open is blocking, which is what can be started right now. */
export function frontier(source: GraphSource): WorkItemBrief[] {
  const ready = readyIds(source.nodes)
  return source.nodes.filter((node) => ready.has(node.work_item_id))
}

export function edgeKey(edge: PlanningEdge): string {
  return `${edge.from}-${edge.to}-${edge.kind}`
}

/**
 * What one hovered item keeps bright: the complete visible dependency lineage.
 * Dependencies are directed, but a lineage includes both transitive ancestors
 * and descendants, so focus walks each edge in both directions. A visited set
 * makes branches and cycles deterministic and bounded.
 */
export function neighborhood(
  edges: PlanningEdge[],
  id: string,
): { edges: Set<string>; ids: Set<string> } {
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to])
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge.from])
  }

  const ids = new Set<string>([id])
  // Breadth-first over a queue that grows while it is read: an array iterator
  // re-reads the length each step, so ids pushed inside the loop are visited.
  // `shift()` would need a `!` to say the same thing, and is O(n) per node.
  const queue = [id]
  for (const current of queue) {
    for (const next of adjacency.get(current) ?? []) {
      if (ids.has(next)) continue
      ids.add(next)
      queue.push(next)
    }
  }

  const keys = new Set<string>()
  for (const edge of edges) {
    if (ids.has(edge.from) && ids.has(edge.to)) keys.add(edgeKey(edge))
  }
  return { ids, edges: keys }
}
