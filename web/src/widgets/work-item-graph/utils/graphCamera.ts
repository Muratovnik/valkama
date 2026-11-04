/**
 * Where the field's camera goes, by cause. Every reader measures the boxes the
 * layout placed — a card, a frame, a frame's header — rather than a card size,
 * because a frame is as large as the work it holds.
 */
import { getTransformForBounds } from '@vue-flow/core'
import type { Dimensions, ViewportTransform } from '@vue-flow/core'

import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { GRAPH_ZOOM_MIN, graphFitViewOptions } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import {
  headerBox,
  nodeCentre,
  readingOrder,
  walkTargets,
} from '@/widgets/work-item-graph/utils/graphWalk.ts'
import type { Box, WalkTarget } from '@/widgets/work-item-graph/utils/graphWalk.ts'

const READABLE_ZOOM = 0.75

/** A padding the fit options state in pixels, as a number. */
const pixels = (value: string) => Number.parseFloat(value)

/** The smallest box round `boxes`. */
function extent(boxes: readonly Box[]): {
  bottom: number
  left: number
  right: number
  top: number
} {
  return {
    left: Math.min(...boxes.map((box) => box.x)),
    top: Math.min(...boxes.map((box) => box.y)),
    right: Math.max(...boxes.map((box) => box.x + box.width)),
    bottom: Math.max(...boxes.map((box) => box.y + box.height)),
  }
}

/** Everything drawn: the frames and the cards in them. */
const drawing = (graph: GraphLayout): Box[] => [...graph.frames, ...graph.nodes]

function fitNodes(boxes: readonly Box[], dimensions: Dimensions): ViewportTransform {
  const { left, top, right, bottom } = extent(boxes)
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

/** The keyboard's target for a card. */
const cardTarget = (node: PlacedNode): WalkTarget => ({
  id: node.work_item_id,
  frameId: node.frameId,
  x: node.x,
  y: node.y,
  width: node.width,
  height: node.height,
})

/**
 * The target a field is placed around, and the one the keyboard enters it on:
 * the first work of the branch the card chose, then the open card's item,
 * then — for a chain — the root the chain grew from, so a reload or a link
 * lands on the same place the card's «Show on graph» does; else the field's
 * first target as it is read, a frame's header or a card.
 *
 * Given where the camera stands (`sight`), the keyboard enters where the
 * operator is looking: that card when it is in sight, else the first target in
 * sight as the field is read; only with nothing in sight does it fall back to
 * the card or the field's first target, which a press then brings into view.
 * In the overview it reads the targets the overview draws (`walkTargets`).
 */
export function graphAnchor(
  graph: GraphLayout,
  options: AnchorOptions = {},
  sight: { camera: ViewportTransform; dimensions: Dimensions; overview?: boolean } | null = null,
): WalkTarget | undefined {
  const [head] = branchWork(graph, options)
  const selected = graph.nodes.find((node) => node.work_item_id === options.selectedId)
  const root = graph.nodes.find((node) => node.work_item_id === options.rootId)
  const card = head ?? selected ?? root
  const chosen = card ? cardTarget(card) : undefined
  const targets = walkTargets(graph, { overview: sight?.overview }).sort(readingOrder)
  if (sight) {
    const inSight = (target: WalkTarget) => seen(target, sight.camera, sight.dimensions)
    const looked = chosen && inSight(chosen) ? chosen : targets.find((target) => inSight(target))
    if (looked) return looked
  }
  return chosen ?? targets[0]
}

/**
 * A run of boxes from its beginning: the whole of it when that reads at its
 * size, otherwise its first box at the top-left at reading size, the rest
 * running on to the right and below.
 */
function beginningView(boxes: readonly Box[], dimensions: Dimensions): ViewportTransform {
  const whole = fitNodes(boxes, dimensions)
  if (whole.zoom >= READABLE_ZOOM) return whole
  const { padding } = graphFitViewOptions()
  const [first] = [...boxes].sort(readingOrder)
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
  const { left, top, right, bottom } = extent(drawing(graph))
  return {
    x: onDrawing(
      camera.x,
      camera.zoom,
      { start: left, end: right },
      {
        gapStart: pixels(padding.left),
        gapEnd: pixels(padding.right),
        size: dimensions.width,
      },
    ),
    y: onDrawing(
      camera.y,
      camera.zoom,
      { start: top, end: bottom },
      {
        gapStart: pixels(padding.top),
        gapEnd: pixels(padding.bottom),
        size: dimensions.height,
      },
    ),
    zoom: camera.zoom,
  }
}

/** Whether a target stands for open work: an open card, or a header of a frame holding some. */
function holdsOpenWork(graph: GraphLayout): (target: WalkTarget) => boolean {
  const cards = new Map(graph.nodes.map((node) => [node.work_item_id, node]))
  const frames = new Map(graph.frames.map((frame) => [frame.id, frame]))
  return (target) => {
    const card = cards.get(target.id)
    if (card) return !card.state.is_terminal
    const frame = frames.get(target.frameId)
    return frame !== undefined && frame.progress.total > frame.progress.done
  }
}

/**
 * The field from its beginning, as it is read. Frames are placed by their
 * size, not by what they hold, so the field can begin with finished frames
 * folded to their headers; when that first screen holds no open work, the
 * field begins at its first open work instead, the finished frames before it
 * a pan away.
 */
function openingView(graph: GraphLayout, dimensions: Dimensions): ViewportTransform {
  const targets = walkTargets(graph)
  const start = keptOnDrawing(beginningView(targets, dimensions), graph, dimensions)
  const open = targets.filter(holdsOpenWork(graph))
  return open.length === 0 || open.some((target) => seen(target, start, dimensions))
    ? start
    : keptOnDrawing(beginningView(open, dimensions), graph, dimensions)
}

/**
 * Where the camera starts: the branch the card chose, from its beginning; else
 * the whole field when it reads at that size and no card is open; else the
 * open card's item or the chain's root with its direct links; else the field
 * from its beginning, its first target at the top-left. Every framing but the
 * whole one is kept on the drawing (`keptOnDrawing`).
 */
export function graphCameraView(
  graph: GraphLayout,
  dimensions: Dimensions,
  options: AnchorOptions = {},
): ViewportTransform | null {
  if (!drawing(graph).length || !dimensions.width || !dimensions.height) return null
  const branch = branchWork(graph, options)
  if (branch.length) return keptOnDrawing(beginningView(branch, dimensions), graph, dimensions)
  const whole = fitNodes(drawing(graph), dimensions)
  const selected = graph.nodes.some((node) => node.work_item_id === options.selectedId)
  if (!selected && whole.zoom >= READABLE_ZOOM) return whole
  const anchor = graphAnchor(graph, options)
  if (!anchor || (!selected && anchor.id !== options.rootId)) return openingView(graph, dimensions)

  const contextIds = new Set([anchor.id])
  for (const edge of graph.edges) {
    if (edge.source === anchor.id) contextIds.add(edge.target)
    if (edge.target === anchor.id) contextIds.add(edge.source)
  }
  const boxes = [
    ...graph.nodes.filter((node) => contextIds.has(node.work_item_id)),
    ...graph.frames.filter((frame) => contextIds.has(frame.id)).map((frame) => headerBox(frame)),
  ]
  const context = fitNodes(boxes, dimensions)
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
 * - `toggled`: the operator folded or opened a frame.
 */
export type GraphCameraCause = 'narrowed' | 'open' | 'refresh' | 'resized' | 'toggled'

/** A frame whose header is held where it stood on the screen while it folds or opens. */
export interface HeldFrame {
  frameId: string
  /** Where its header's top-left corner stood on the screen. */
  screen: { x: number; y: number }
}

/** Where on the screen a frame's header stands at a camera; null when it is not drawn. */
export function headerOnScreen(
  graph: GraphLayout,
  frameId: string,
  camera: ViewportTransform,
): { x: number; y: number } | null {
  const frame = graph.frames.find((entry) => entry.id === frameId)
  return frame ? { x: frame.x * camera.zoom + camera.x, y: frame.y * camera.zoom + camera.y } : null
}

/** Whether a box's centre stands inside the field at this camera. */
function seen(box: Box, camera: ViewportTransform, dimensions: Dimensions): boolean {
  const centre = nodeCentre(box)
  const x = centre.x * camera.zoom + camera.x
  const y = centre.y * camera.zoom + camera.y
  return x >= 0 && y >= 0 && x <= dimensions.width && y <= dimensions.height
}

/**
 * The camera at the same zoom, moved onto the drawing: the whole of it centred
 * when it fits at this zoom, else centred on its first target as it is read.
 */
function panOnto(
  graph: GraphLayout,
  camera: ViewportTransform,
  dimensions: Dimensions,
): ViewportTransform {
  const { padding } = graphFitViewOptions()
  const { left, top, right, bottom } = extent(drawing(graph))
  const fits =
    (right - left) * camera.zoom <=
      dimensions.width - pixels(padding.left) - pixels(padding.right) &&
    (bottom - top) * camera.zoom <= dimensions.height - pixels(padding.top) - pixels(padding.bottom)
  // A card before a header: a header is as wide as its frame, so centring on
  // it can leave the frame's first card cut at the field's edge.
  const [first] = [...(graph.nodes.length ? graph.nodes : walkTargets(graph))].sort(readingOrder)
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
 * the opening frame (`graphCameraView`); a refresh never moves it; a frame the
 * operator folded or opened keeps its header where it stood on the screen, so
 * what was pressed does not move from under the hand, at the same zoom; and a
 * new queue, search or switch — or a field that changed size — moves it only
 * when not one drawn box is left in sight, and then only across, at the zoom
 * the operator chose. The explicit «Fit whole graph» is the one way to change
 * the zoom besides the operator's own, and it is Vue Flow's own fit.
 */
export function graphCameraMove(
  cause: GraphCameraCause,
  graph: GraphLayout,
  field: { camera: ViewportTransform; dimensions: Dimensions; held?: HeldFrame | null },
  options: AnchorOptions = {},
): ViewportTransform | null {
  const { camera, dimensions } = field
  if (!drawing(graph).length || !dimensions.width || !dimensions.height) return null
  if (cause === 'open') return graphCameraView(graph, dimensions, options)
  if (cause === 'refresh') return null
  if (cause === 'toggled' && field.held) {
    const now = headerOnScreen(graph, field.held.frameId, camera)
    if (!now) return null
    return {
      x: camera.x + field.held.screen.x - now.x,
      y: camera.y + field.held.screen.y - now.y,
      zoom: camera.zoom,
    }
  }
  // A frame's own centre can be empty ground, and its fold button alone at the
  // field's edge shows nothing of it; what the operator sees is a header as a
  // whole or a card, so those are what count as in sight.
  const sights = [...graph.frames.map((frame) => headerBox(frame)), ...graph.nodes]
  return sights.some((box) => seen(box, camera, dimensions))
    ? null
    : panOnto(graph, camera, dimensions)
}
