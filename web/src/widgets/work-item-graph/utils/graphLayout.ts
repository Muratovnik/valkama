/**
 * What the graph view needs to draw a space: the geometry, the edge shape, the
 * zoom bounds, and which items are in scope.
 *
 * The layered layout itself lives in `graphSugiyama.ts`; this file calls it once
 * and arranges what comes back.
 */

import {
  COLUMN_WIDTH,
  COMPONENT_GAP,
  ISOLATED_ROWS,
  MARGIN,
  NODE_HEIGHT,
  SECTION_GAP,
} from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import {
  connectedComponents,
  gridRows,
  layoutComponent,
} from '@/widgets/work-item-graph/utils/graphSugiyama.ts'

import { readyIds } from '@/shared/api/planningModel.ts'
import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

/** The slice of the read model a graph draws: items and the links between them. */
export interface GraphSource {
  edges: PlanningEdge[]
  nodes: WorkItemBrief[]
}

export interface GraphLayout {
  /** Dependency edges retain the persisted source/target direction. */
  edges: PlanningEdge[]
  height: number
  isolatedCount: number
  /** Top (px) of the "unlinked" grid, or -1 when every visible item is wired. */
  isolatedTop: number
  nodes: PlacedNode[]
  /** Rank columns of the widest wired component; 0 when nothing is connected. */
  ranks: number
  width: number
  /** Bottom edge (px) of the wired section; 0 when nothing is connected. */
  wiredBottom: number
}

/** Keep the interaction floor low enough for wide spaces to fit without clipping. */
export const GRAPH_ZOOM_MIN = 0.1
export const GRAPH_ZOOM_MAX = 1.45

/** Vue Flow's built-in edge and marker contract for every dependency wire. */
export const GRAPH_EDGE_TYPE = 'straight' as const
export const GRAPH_EDGE_MARKER_SIZE = 14

export interface GraphFlowEdge {
  class: string[]
  data: { kind: PlanningEdge['kind'] }
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
  padding: number
}

export function graphFitViewOptions(): GraphFitViewOptions {
  return { padding: 0.18, duration: 0, maxZoom: 1 }
}

/**
 * Convert one persisted dependency into a Vue Flow straight edge descriptor.
 * The source and target are never swapped for layout convenience: Vue Flow
 * connects the right border of the source node to the left border of target.
 */
export function flowEdge(
  edge: PlanningEdge,
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
    data: { kind: edge.kind },
  }
}

/** Which slice of the space the graph draws; mirrors the epic rail selection. */
export interface GraphScope {
  epicId: string | null
  kind: 'all' | 'epic' | 'none'
}

const WHOLE_SPACE: GraphScope = { kind: 'all', epicId: null }

function inScope(node: WorkItemBrief, scope: GraphScope): boolean {
  if (scope.kind === 'epic') return node.parent_id === scope.epicId
  if (scope.kind === 'none') return node.parent_id === null
  return true
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
 */
export function workNodes(
  source: GraphSource,
  showDone: boolean,
  scope: GraphScope = WHOLE_SPACE,
): WorkItemBrief[] {
  return source.nodes.filter(
    (node) => !node.container && (showDone || !node.state.is_terminal) && inScope(node, scope),
  )
}

/** How many finished items the "show done" control is currently hiding. */
export function doneCount(source: GraphSource, scope: GraphScope = WHOLE_SPACE): number {
  return source.nodes.filter(
    (node) => !node.container && node.state.is_terminal && inScope(node, scope),
  ).length
}

export function layout(
  source: GraphSource,
  showDone = false,
  scope: GraphScope = WHOLE_SPACE,
): GraphLayout {
  const nodes = workNodes(source, showDone, scope)
  const present = new Set(nodes.map((node) => node.work_item_id))
  const visible = source.edges.filter(
    (edge) => edge.from !== edge.to && present.has(edge.from) && present.has(edge.to),
  )

  const { components, isolated } = connectedComponents(nodes, visible)

  const placed: PlacedNode[] = []
  const edges: PlanningEdge[] = []
  let ranks = 0
  let cursor = MARGIN
  let width = 0
  for (const component of components) {
    const block = layoutComponent(component.nodes, component.edges)
    for (const node of block.nodes) placed.push({ ...node, y: node.y + cursor })
    for (const edge of block.edges) edges.push({ ...edge })
    ranks = Math.max(ranks, block.ranks)
    cursor += block.height + COMPONENT_GAP
    width = Math.max(width, MARGIN + block.ranks * COLUMN_WIDTH)
  }
  const wiredBottom = components.length ? cursor - COMPONENT_GAP : 0

  // -1 means there is no grid at all, which is what the renderer reads to skip
  // the section heading entirely.
  let isolatedTop = -1
  if (isolated.length) {
    isolatedTop = components.length ? wiredBottom + SECTION_GAP : MARGIN
    placed.push(...gridRows(isolated, isolatedTop))
    const columns = Math.ceil(isolated.length / ISOLATED_ROWS)
    width = Math.max(width, MARGIN + columns * COLUMN_WIDTH)
  }

  let bottom = MARGIN
  for (const node of placed) {
    bottom = Math.max(bottom, node.y + NODE_HEIGHT)
  }
  return {
    nodes: placed,
    edges,
    width: Math.max(width, MARGIN) + MARGIN,
    height: bottom + MARGIN,
    ranks,
    wiredBottom,
    isolatedCount: isolated.length,
    isolatedTop,
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
