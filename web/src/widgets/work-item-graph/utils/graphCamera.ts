import { getTransformForBounds } from '@vue-flow/core'
import type { Dimensions, ViewportTransform } from '@vue-flow/core'

import { NODE_HEIGHT, NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { GRAPH_ZOOM_MIN, graphFitViewOptions } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { nodeCentre, readingOrder } from '@/widgets/work-item-graph/utils/graphWalk.ts'

const READABLE_ZOOM = 0.75

/** A padding the fit options state in pixels, as a number. */
const pixels = (value: string) => Number.parseFloat(value)

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

/** A branch of a chain the field is framed on: its drawn nodes, and the epic that heads it. */
export interface GraphBranchFrame {
  headId: string | null
  ids: ReadonlySet<string>
}

interface AnchorOptions {
  branch?: GraphBranchFrame | null
  rootId?: string | null
  selectedId?: string | null
}

/**
 * The work of the branch the card chose, as the field reads it: top to bottom,
 * then left to right. Its epic is lit with it but drawn wherever its own chain
 * puts it, often far from its work, so it is framed only when nothing else of
 * the branch is drawn.
 */
function branchWork(graph: GraphLayout, options: AnchorOptions): PlacedNode[] {
  const branch = options.branch
  if (!branch) return []
  const drawn = graph.nodes.filter((node) => branch.ids.has(node.work_item_id)).sort(readingOrder)
  const work = drawn.filter((node) => node.work_item_id !== branch.headId)
  return work.length ? work : drawn
}

/**
 * The node a field is placed around, and the one the keyboard enters it on:
 * the first work of the branch the card chose, then the open card's item,
 * then — for a chain — the root the chain grew from, so a reload or a link
 * lands on the same place the card's «Show on graph» does; else the field's
 * first node as it is read.
 */
export function graphAnchor(
  graph: GraphLayout,
  options: AnchorOptions = {},
): PlacedNode | undefined {
  const [head] = branchWork(graph, options)
  const selected = graph.nodes.find((node) => node.work_item_id === options.selectedId)
  const root = graph.nodes.find((node) => node.work_item_id === options.rootId)
  return head ?? selected ?? root ?? [...graph.nodes].sort(readingOrder)[0]
}

/**
 * A run of nodes from its beginning: the whole of it when that reads at its
 * size, otherwise its first node at the top-left at reading size, the rest
 * running on to the right and below.
 */
function beginningView(nodes: PlacedNode[], dimensions: Dimensions): ViewportTransform {
  const whole = fitNodes(nodes, dimensions)
  if (whole.zoom >= READABLE_ZOOM) return whole
  const { padding } = graphFitViewOptions()
  const [first] = nodes
  return {
    x: pixels(padding.left) - first.x * READABLE_ZOOM,
    y: pixels(padding.top) - first.y * READABLE_ZOOM,
    zoom: READABLE_ZOOM,
  }
}

/**
 * One axis of a framing kept on the drawing: where the drawing is wider than
 * the field, no edge of the field is left empty past the drawing's own edge;
 * where it fits, it starts at the field's start, as it is read.
 */
function onDrawing(
  position: number,
  zoom: number,
  span: { end: number; start: number },
  field: { gapEnd: number; gapStart: number; size: number },
): number {
  const start = field.gapStart - span.start * zoom
  if ((span.end - span.start) * zoom <= field.size - field.gapStart - field.gapEnd) return start
  const end = field.size - field.gapEnd - span.end * zoom
  return Math.min(start, Math.max(end, position))
}

/**
 * A framing narrower than the whole field, moved so the drawing fills the
 * field: centred on an anchor near the drawing's edge, it would show empty
 * ground on that side while the drawing runs off the other. The move is never
 * more than that empty ground, so the anchor stays in sight.
 */
function keptOnDrawing(
  camera: ViewportTransform,
  graph: GraphLayout,
  dimensions: Dimensions,
): ViewportTransform {
  const { padding } = graphFitViewOptions()
  const across = {
    start: Math.min(...graph.nodes.map((node) => node.x)),
    end: Math.max(...graph.nodes.map((node) => node.x + NODE_WIDTH)),
  }
  const down = {
    start: Math.min(...graph.nodes.map((node) => node.y)),
    end: Math.max(...graph.nodes.map((node) => node.y + NODE_HEIGHT)),
  }
  return {
    x: onDrawing(camera.x, camera.zoom, across, {
      gapStart: pixels(padding.left),
      gapEnd: pixels(padding.right),
      size: dimensions.width,
    }),
    y: onDrawing(camera.y, camera.zoom, down, {
      gapStart: pixels(padding.top),
      gapEnd: pixels(padding.bottom),
      size: dimensions.height,
    }),
    zoom: camera.zoom,
  }
}

/**
 * Where the camera starts: the branch the card chose, from its beginning; else
 * the whole field when it reads at that size and no card is open; else the
 * open card's item or the chain's root with its direct links; else the field
 * from its beginning. Every framing but the whole one is kept on the drawing
 * (`keptOnDrawing`).
 */
export function graphCameraView(
  graph: GraphLayout,
  dimensions: Dimensions,
  options: AnchorOptions = {},
): ViewportTransform | null {
  if (!graph.nodes.length || !dimensions.width || !dimensions.height) return null
  const branch = branchWork(graph, options)
  if (branch.length) return keptOnDrawing(beginningView(branch, dimensions), graph, dimensions)
  const whole = fitNodes(graph.nodes, dimensions)
  const selected = graph.nodes.some((node) => node.work_item_id === options.selectedId)
  if (!selected && whole.zoom >= READABLE_ZOOM) return whole
  const anchor = graphAnchor(graph, options) ?? graph.nodes[0]
  if (!selected && anchor.work_item_id !== options.rootId) {
    const field = [...graph.nodes].sort(readingOrder)
    return keptOnDrawing(beginningView(field, dimensions), graph, dimensions)
  }

  const contextIds = new Set([anchor.work_item_id])
  for (const edge of graph.edges) {
    if (edge.from === anchor.work_item_id) contextIds.add(edge.to)
    if (edge.to === anchor.work_item_id) contextIds.add(edge.from)
  }
  const context = fitNodes(
    graph.nodes.filter((node) => contextIds.has(node.work_item_id)),
    dimensions,
  )
  const framed = context.zoom >= READABLE_ZOOM ? context : fitNodes([anchor], dimensions)
  return keptOnDrawing(framed, graph, dimensions)
}

/**
 * Why the field might move its camera now.
 *
 * - `open`: a different scope opened — another project, chain or branch — or
 *   the field is drawn for the first time.
 * - `narrowed`: the queue, the search or a switch changed what is drawn.
 * - `resized`: the field's box changed size under a drawing.
 * - `refresh`: the same field arrived again with new data.
 */
export type GraphCameraCause = 'narrowed' | 'open' | 'refresh' | 'resized'

/** Whether a node's centre stands inside the field at this camera. */
function seen(node: PlacedNode, camera: ViewportTransform, dimensions: Dimensions): boolean {
  const centre = nodeCentre(node)
  const x = centre.x * camera.zoom + camera.x
  const y = centre.y * camera.zoom + camera.y
  return x >= 0 && y >= 0 && x <= dimensions.width && y <= dimensions.height
}

/**
 * The camera at the same zoom, moved onto the drawing: the whole of it centred
 * when it fits at this zoom, else centred on its first node as it is read.
 */
function panOnto(
  graph: GraphLayout,
  camera: ViewportTransform,
  dimensions: Dimensions,
): ViewportTransform {
  const { padding } = graphFitViewOptions()
  const left = Math.min(...graph.nodes.map((node) => node.x))
  const top = Math.min(...graph.nodes.map((node) => node.y))
  const right = Math.max(...graph.nodes.map((node) => node.x + NODE_WIDTH))
  const bottom = Math.max(...graph.nodes.map((node) => node.y + NODE_HEIGHT))
  const fits =
    (right - left) * camera.zoom <=
      dimensions.width - pixels(padding.left) - pixels(padding.right) &&
    (bottom - top) * camera.zoom <= dimensions.height - pixels(padding.top) - pixels(padding.bottom)
  const [first] = [...graph.nodes].sort(readingOrder)
  const centre = fits ? { x: (left + right) / 2, y: (top + bottom) / 2 } : nodeCentre(first)
  return {
    x: dimensions.width / 2 - centre.x * camera.zoom,
    y: dimensions.height / 2 - centre.y * camera.zoom,
    zoom: camera.zoom,
  }
}

/**
 * Where the camera goes, or null to leave it where the operator put it.
 *
 * The camera is the operator's. The field places it when a scope opens, by
 * the opening frame (`graphCameraView`); a refresh never moves it; and a new
 * queue, search or switch — or a field that changed size — moves it only when
 * not one drawn node is left in sight, and then only across, at the zoom the
 * operator chose. The explicit «Fit whole graph» is the one way to change the
 * zoom besides the operator's own, and it is Vue Flow's own fit.
 */
export function graphCameraMove(
  cause: GraphCameraCause,
  graph: GraphLayout,
  field: { camera: ViewportTransform; dimensions: Dimensions },
  options: AnchorOptions = {},
): ViewportTransform | null {
  const { camera, dimensions } = field
  if (!graph.nodes.length || !dimensions.width || !dimensions.height) return null
  if (cause === 'open') return graphCameraView(graph, dimensions, options)
  if (cause === 'refresh') return null
  if (graph.nodes.some((node) => seen(node, camera, dimensions))) return null
  return panOnto(graph, camera, dimensions)
}
