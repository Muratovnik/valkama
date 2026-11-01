import { getTransformForBounds } from '@vue-flow/core'
import type { Dimensions, ViewportTransform } from '@vue-flow/core'

import { NODE_HEIGHT, NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { GRAPH_ZOOM_MIN, graphFitViewOptions } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'

const READABLE_ZOOM = 0.75

function fitNodes(nodes: PlacedNode[], dimensions: Dimensions): ViewportTransform {
  const left = Math.min(...nodes.map((node) => node.x))
  const top = Math.min(...nodes.map((node) => node.y))
  const right = Math.max(...nodes.map((node) => node.x + NODE_WIDTH))
  const bottom = Math.max(...nodes.map((node) => node.y + NODE_HEIGHT))
  const options = graphFitViewOptions()
  return getTransformForBounds(
    { x: left, y: top, width: right - left, height: bottom - top },
    dimensions.width,
    dimensions.height,
    GRAPH_ZOOM_MIN,
    options.maxZoom,
    options.padding,
  )
}

interface AnchorOptions {
  focusOnly?: boolean
  rootId?: string | null
  selectedId?: string | null
}

/**
 * The node a field is placed around, and the one the keyboard enters it on:
 * the open card's item, then — for a chain — the root the chain grew from, so
 * a reload or a link lands on the same place the card's «Show on graph» does;
 * then the first workable item. «Focus work» asks for workable work, so it
 * skips the root.
 */
export function graphAnchor(
  graph: GraphLayout,
  readyIds: Set<string>,
  options: AnchorOptions = {},
): PlacedNode | undefined {
  const selected = graph.nodes.find((node) => node.work_item_id === options.selectedId)
  const root = options.focusOnly
    ? undefined
    : graph.nodes.find((node) => node.work_item_id === options.rootId)
  const incoming = new Set(graph.edges.map((edge) => edge.to))
  return (
    selected ??
    root ??
    graph.nodes.find((node) => readyIds.has(node.work_item_id)) ??
    graph.nodes.find((node) => !incoming.has(node.work_item_id)) ??
    graph.nodes[0]
  )
}

/**
 * Where the camera starts: the whole field when it reads at that size,
 * otherwise the anchor (`graphAnchor`) and its direct links.
 */
export function graphCameraView(
  graph: GraphLayout,
  dimensions: Dimensions,
  readyIds: Set<string>,
  options: AnchorOptions = {},
): ViewportTransform | null {
  if (!graph.nodes.length || !dimensions.width || !dimensions.height) return null
  const whole = fitNodes(graph.nodes, dimensions)
  const selected = graph.nodes.find((node) => node.work_item_id === options.selectedId)
  if (!options.focusOnly && !selected && whole.zoom >= READABLE_ZOOM) return whole

  const anchor = graphAnchor(graph, readyIds, options) ?? graph.nodes[0]
  const contextIds = new Set([anchor.work_item_id])
  for (const edge of graph.edges) {
    if (edge.from === anchor.work_item_id) contextIds.add(edge.to)
    if (edge.to === anchor.work_item_id) contextIds.add(edge.from)
  }
  const context = fitNodes(
    graph.nodes.filter((node) => contextIds.has(node.work_item_id)),
    dimensions,
  )
  return context.zoom >= READABLE_ZOOM ? context : fitNodes([anchor], dimensions)
}
