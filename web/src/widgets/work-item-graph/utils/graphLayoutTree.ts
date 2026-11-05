/**
 * A space's frames laid out in one ELK call.
 *
 * ELK's hierarchical pass (`INCLUDE_CHILDREN`) routes a line into a frame and
 * between frames, which a pass per frame cannot, but it does not separate
 * connected components: the frames no line joins would stand in one column, and
 * the cards nothing links in another. So the space is cut into components
 * before ELK sees it — the top-level frames joined by a drawn line, and every
 * other frame alone — each laid out hierarchically and packed by `box` at the
 * root, those holding open work first and, in a space with many lone epics, on
 * shelves (`SHELF_FROM`); inside a frame, the cards no line touches are packed by
 * `box` too.
 *
 * The hierarchical pass fails outright on options the flat one takes in its
 * stride: `considerModelOrder` and `wrapping` each end it with a TypeError.
 * The options of every hierarchical node are therefore closed lists below, and
 * determinism comes from the input's order instead: components, frames and
 * cards are sorted before ELK is called.
 */

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api'

import type { FrameProjection } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import {
  FOLDED_WIDTH,
  FRAME_HEADER,
  FRAME_PADDING,
  MARGIN,
  NODE_HEIGHT,
  NODE_WIDTH,
} from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedFrame, PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type {
  GraphLayout,
  GraphLayoutEngine,
  RoutedEdge,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'

type Frame = FrameProjection['frames'][number]

/** The root: components packed side by side, every coordinate given in its space. */
export const ROOT_OPTIONS: Readonly<Record<string, string>> = {
  'elk.algorithm': 'box',
  'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
  'elk.aspectRatio': '1.7',
  'elk.padding': `[top=${MARGIN},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]`,
  'elk.spacing.nodeNode': '48',
  'elk.json.edgeCoords': 'ROOT',
  'elk.json.shapeCoords': 'ROOT',
}

/**
 * A component and every open frame in it. The list is closed: an option the
 * flat layout uses is not safe here until a layout with frames proves it.
 */
export const HIERARCHY_OPTIONS: Readonly<Record<string, string>> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.spacing.nodeNode': '36',
  'elk.layered.spacing.nodeNodeBetweenLayers': '64',
  'elk.layered.spacing.edgeNodeBetweenLayers': '20',
  'elk.spacing.edgeNode': '20',
  'elk.spacing.edgeEdge': '12',
}

/** An open frame's own additions: room for its header, and never narrower than folded. */
export const FRAME_OPTIONS: Readonly<Record<string, string>> = {
  ...HIERARCHY_OPTIONS,
  'elk.padding': `[top=${FRAME_HEADER},left=${FRAME_PADDING},bottom=${FRAME_PADDING},right=${FRAME_PADDING}]`,
  'elk.nodeSize.constraints': 'MINIMUM_SIZE',
  'elk.nodeSize.minimum': `(${FOLDED_WIDTH}, ${FRAME_HEADER})`,
}

/** A card and the air round it, as a block packs it. */
const CELL = { width: NODE_WIDTH + 36, height: NODE_HEIGHT + 36 }
const FIELD_ASPECT = 1.7

/**
 * How wide a frame's block of unlinked cards is drawn. The linked work beside
 * it stands in a column of its own, a little over half its cards tall, and the
 * block stands under that column; so the block is made as wide as keeps the
 * whole frame near the field's shape, rather than square under a tall column.
 */
function looseAspect(linked: number, loose: number): number {
  if (linked === 0) return FIELD_ASPECT
  const area = loose * CELL.width * CELL.height
  const column = FIELD_ASPECT * Math.ceil(linked / 2) * CELL.height
  const width = (column + Math.sqrt(column * column + 4 * FIELD_ASPECT * area)) / 2
  return Math.min(8, Math.max(1, (width * width) / area))
}

/** The cards in a frame no line touches, packed as a block. */
export function looseOptions(linked: number, loose: number): Record<string, string> {
  return {
    'elk.algorithm': 'box',
    'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
    'elk.aspectRatio': looseAspect(linked, loose).toFixed(2),
    'elk.padding': '[top=0,left=0,bottom=0,right=0]',
    'elk.spacing.nodeNode': '36',
  }
}

const card = (id: string): ElkNode => ({ id, width: NODE_WIDTH, height: NODE_HEIGHT })

/** The ELK node of one frame, with the frames standing in it. */
function frameNode(frame: Frame, nested: Map<string, Frame[]>, touched: Set<string>): ElkNode {
  if (frame.folded) return { id: frame.id, width: FOLDED_WIDTH, height: FRAME_HEADER }
  const linked = frame.cards.filter((item) => touched.has(item.work_item_id))
  const loose = frame.cards.filter((item) => !touched.has(item.work_item_id))
  const inner = (nested.get(frame.id) ?? []).map((child) => frameNode(child, nested, touched))
  const children = [...linked.map((item) => card(item.work_item_id)), ...inner]
  if (loose.length) {
    children.push({
      id: `${frame.id}:loose`,
      layoutOptions: looseOptions(children.length, loose.length),
      children: loose.map((item) => card(item.work_item_id)),
    })
  }
  return { id: frame.id, layoutOptions: { ...FRAME_OPTIONS }, children }
}

/** The top-level frame each drawn frame and card stands in. */
function topFrames(projection: FrameProjection): Map<string, string> {
  const parents = new Map(projection.frames.map((frame) => [frame.id, frame.parentId]))
  const top = (frameId: string): string => {
    let at = frameId
    for (let parent = parents.get(at); parent; parent = parents.get(at)) at = parent
    return at
  }
  const homeOf = new Map<string, string>()
  for (const frame of projection.frames) {
    homeOf.set(frame.id, top(frame.id))
    if (frame.folded) continue
    for (const item of frame.cards) homeOf.set(item.work_item_id, top(frame.id))
  }
  return homeOf
}

/** Top-level frames joined by a drawn line, each set in the order its first frame is read. */
function components(projection: FrameProjection): Frame[][] {
  const homeOf = topFrames(projection)
  const order = new Map(projection.frames.map((frame, index) => [frame.id, index]))
  const rank = (id: string) => order.get(id) ?? 0
  const root = new Map<string, string>()
  const find = (id: string): string => {
    const parent = root.get(id) ?? id
    if (parent === id) return id
    const found = find(parent)
    root.set(id, found)
    return found
  }
  for (const edge of projection.edges) {
    const [first, last] = [
      find(homeOf.get(edge.source) ?? edge.source),
      find(homeOf.get(edge.target) ?? edge.target),
    ].sort((left, right) => rank(left) - rank(right))
    // The frame read first stays the root, so a component is named by its first.
    if (first !== last) root.set(last, first)
  }
  const groups = new Map<string, Frame[]>()
  for (const frame of projection.frames) {
    if (frame.parentId !== null) continue
    const key = find(frame.id)
    groups.set(key, [...(groups.get(key) ?? []), frame])
  }
  return [...groups.values()].sort((left, right) => rank(left[0].id) - rank(right[0].id))
}

/**
 * The priority of a component holding open work at the root. `box` places a
 * higher priority first and, within one, the smaller first; without it the
 * small folded frames of finished epics lead the field, and the open work
 * stands a pan away from where the field is read.
 */
const OPEN_FIRST = 1

/**
 * From this many lone frames with open work — epics no drawn line joins to
 * another — the root packs them on a shelf of their own. `box` lays its
 * children in rows as wide as its widest child and as tall as its tallest, so a
 * row of small lone epics beside a component of linked epics thousands of
 * pixels wide is one thin strip with empty field under it. Its grouping modes
 * stack small boxes to fill a row, but they ignore priorities, so each shelf is
 * a `box` of its own and only the shelves carry a priority: lone open epics,
 * then linked open work, then finished frames. With few lone epics the rows
 * are already full, and the root packs the components as they are.
 */
export const SHELF_FROM = 5

/** A shelf: a `box` that stacks its small children to fill each row. */
const SHELF_OPTIONS: Readonly<Record<string, string>> = {
  'elk.algorithm': 'box',
  'elk.hierarchyHandling': 'SEPARATE_CHILDREN',
  'elk.box.packingMode': 'GROUP_MIXED',
  'elk.aspectRatio': '1.7',
  'elk.padding': '[top=0,left=0,bottom=0,right=0]',
  'elk.spacing.nodeNode': '48',
}

interface Component {
  /** It holds a single top-level frame, which no drawn line joins to another. */
  lone: boolean
  node: ElkNode
  open: boolean
}

/** The root's children: the components themselves, or the shelves they stand on. */
function rootChildren(components: readonly Component[]): ElkNode[] {
  const loneOpen = components.filter((component) => component.open && component.lone)
  if (loneOpen.length < SHELF_FROM) {
    return components.map(({ node, open }) =>
      open
        ? { ...node, layoutOptions: { ...node.layoutOptions, 'elk.priority': String(OPEN_FIRST) } }
        : node,
    )
  }
  const shelves = [
    { id: 'shelf:open-lone', members: loneOpen, priority: OPEN_FIRST + 1 },
    {
      id: 'shelf:open-linked',
      members: components.filter((component) => component.open && !component.lone),
      priority: OPEN_FIRST,
    },
    {
      id: 'shelf:finished',
      members: components.filter((component) => !component.open),
      priority: 0,
    },
  ]
  return shelves
    .filter((shelf) => shelf.members.length > 0)
    .map((shelf) => ({
      id: shelf.id,
      layoutOptions: { ...SHELF_OPTIONS, 'elk.priority': String(shelf.priority) },
      children: shelf.members.map((member) => member.node),
    }))
}

/** The ELK graph of a space's frames: one component per node of the root. */
export function frameGraph(projection: FrameProjection): ElkNode {
  const touched = new Set(projection.edges.flatMap((edge) => [edge.source, edge.target]))
  const nested = new Map<string, Frame[]>()
  for (const frame of projection.frames) {
    if (frame.parentId === null) continue
    nested.set(frame.parentId, [...(nested.get(frame.parentId) ?? []), frame])
  }
  const home = new Map<string, number>()
  const groups = components(projection)
  const children = groups.map((group, index): ElkNode => {
    const nodes = group.map((frame) => frameNode(frame, nested, touched))
    const mark = (node: ElkNode) => {
      home.set(node.id, index)
      for (const child of node.children ?? []) mark(child)
    }
    for (const node of nodes) mark(node)
    return { id: `component:${index}`, layoutOptions: { ...HIERARCHY_OPTIONS }, children: nodes }
  })
  for (const edge of projection.edges) {
    const component = children[home.get(edge.source) ?? -1] as ElkNode | undefined
    if (!component) throw new Error(`A drawn line has no end on the field: ${edge.id}`)
    const routed: ElkExtendedEdge = { id: edge.id, sources: [edge.source], targets: [edge.target] }
    component.edges = [...(component.edges ?? []), routed]
  }
  const packed = children.map((node, index) => ({
    node,
    open: groups[index].some((frame) => frame.open > 0),
    lone: groups[index].length === 1,
  }))
  return {
    id: 'work-graph',
    layoutOptions: { ...ROOT_OPTIONS },
    children: rootChildren(packed),
  }
}

/** Every node of a laid-out graph by id, however deep. */
function flatten(node: ElkNode, into = new Map<string, ElkNode>()): Map<string, ElkNode> {
  for (const child of node.children ?? []) {
    into.set(child.id, child)
    flatten(child, into)
  }
  return into
}

function box(node: ElkNode | undefined, what: string) {
  if (node?.x === undefined || node.y === undefined)
    throw new Error(`Incomplete graph layout: ${what}`)
  return { x: node.x, y: node.y, width: node.width ?? 0, height: node.height ?? 0 }
}

/** Lays out a space's frames and reads the answer back in the field's own space. */
export async function layoutFrames(
  projection: FrameProjection,
  engine: GraphLayoutEngine,
): Promise<GraphLayout> {
  if (!projection.frames.length)
    return { nodes: [], frames: [], edges: [], width: MARGIN * 2, height: MARGIN * 2 }
  const result = await engine.layout(frameGraph(projection))
  const placed = flatten(result)
  const routes = new Map<string, ElkExtendedEdge>()
  for (const node of placed.values()) for (const edge of node.edges ?? []) routes.set(edge.id, edge)

  const frames = projection.frames.map((frame): PlacedFrame => ({
    id: frame.id,
    epic: frame.epic,
    parentId: frame.parentId,
    folded: frame.folded,
    foldable: frame.foldable,
    progress: frame.progress,
    members: frame.members,
    ...box(placed.get(frame.id), frame.id),
  }))
  const nodes = projection.frames
    .filter((frame) => !frame.folded)
    .flatMap((frame) =>
      frame.cards.map((item): PlacedNode => ({
        ...item,
        frameId: frame.id,
        ...box(placed.get(item.work_item_id), item.reference),
      })),
    )
  const edges = projection.edges.map((edge): RoutedEdge => {
    const sections = routes.get(edge.id)?.sections
    if (!sections?.length) throw new Error(`Incomplete graph route: ${edge.id}`)
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
    nodes,
    frames,
    edges,
    width: result.width ?? MARGIN * 2,
    height: result.height ?? MARGIN * 2,
  }
}
