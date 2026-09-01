/**
 * Sugiyama over one connected component, and the stacking of components.
 *
 * Longest-path ranks, dummy slots for edges that span more than one rank,
 * barycenter sweeps with a transpose pass scored by crossing count, median row
 * alignment, then the block pinned back to row zero. The recipe is dot's, and the
 * four fruitless sweeps that end the search are dagre's.
 */

import {
  COLUMN_WIDTH,
  columnX,
  ISOLATED_ROWS,
  MARGIN,
  MAX_SWEEPS,
  NODE_HEIGHT,
  PATIENCE,
  ROW_HEIGHT,
  rowOrder,
} from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

interface StructEdge {
  original: PlanningEdge
  source: string
  target: string
}

/** A rank slot: a real item, or an intermediate slot used by rank calculation. */
interface Slot {
  id: string
  node: WorkItemBrief | null
}

/**
 * Dummy slot ids. A work item id is a lowercase UUID, so a leading `~` cannot
 * collide with one; the Board era could use negative integers for the same
 * purpose, which string ids no longer allow.
 */
function dummyId(sequence: number): string {
  return `~${sequence}`
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function compare(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * Depth-first orientation over every visible dependency. Weak edges rank like
 * strong ones (a discovery may not point at an item standing left of its
 * origin). A cycle back-edge is oriented only inside the rank solver; the
 * persisted edge remains untouched for Vue Flow.
 */
function orientAcyclic(ids: string[], edges: PlanningEdge[]): StructEdge[] {
  const adjacency = new Map<string, PlanningEdge[]>()
  for (const id of ids) adjacency.set(id, [])
  for (const edge of edges) adjacency.get(edge.from)?.push(edge)
  for (const list of adjacency.values()) {
    list.sort((left, right) => compare(left.to, right.to) || left.kind.localeCompare(right.kind))
  }
  const state = new Map<string, 0 | 1 | 2>()
  const result: StructEdge[] = []
  const visit = (id: string) => {
    state.set(id, 1)
    for (const edge of adjacency.get(id) ?? []) {
      if (state.get(edge.to) === 1) {
        result.push({ source: edge.to, target: edge.from, original: edge })
        continue
      }
      result.push({ source: edge.from, target: edge.to, original: edge })
      if (!state.get(edge.to)) visit(edge.to)
    }
    state.set(id, 2)
  }
  for (const id of ids) if (!state.get(id)) visit(id)
  return result
}

/** Longest-path ranks, then dot-style tightening: a pure source hugs its work. */
function rankNodes(ids: string[], struct: StructEdge[]): Map<string, number> {
  const incoming = new Map<string, StructEdge[]>()
  const outgoing = new Map<string, StructEdge[]>()
  for (const id of ids) {
    incoming.set(id, [])
    outgoing.set(id, [])
  }
  for (const edge of struct) {
    incoming.get(edge.target)?.push(edge)
    outgoing.get(edge.source)?.push(edge)
  }
  const rank = new Map<string, number>()
  const resolve = (id: string): number => {
    const known = rank.get(id)
    if (known !== undefined) return known
    rank.set(id, 0)
    const value = Math.max(0, ...(incoming.get(id) ?? []).map((edge) => resolve(edge.source) + 1))
    rank.set(id, value)
    return value
  }
  for (const id of ids) resolve(id)
  for (const id of ids) {
    if (incoming.get(id)?.length) continue
    const outs = outgoing.get(id) ?? []
    if (!outs.length) continue
    rank.set(id, Math.max(0, Math.min(...outs.map((edge) => resolve(edge.target))) - 1))
  }
  return rank
}

interface ComponentLayout {
  edges: PlanningEdge[]
  /** Height of the block with rows starting at zero. */
  height: number
  nodes: PlacedNode[]
  ranks: number
}

/** Layers of slots, the adjacency in both directions, and each slot's rank. */
interface LayeredGraph {
  down: Map<string, string[]>
  layers: Slot[][]
  slotRank: Map<string, number>
  up: Map<string, string[]>
}

/**
 * One slot per node, plus a chain of dummy slots for every edge that spans more
 * than one rank, so each layer only ever links to the one next to it.
 *
 * The initial order is a DFS from the sources: a tree drawn this way already has
 * no crossings, and the sweeps in `orderLayers` only improve on it.
 */
function buildLayers(
  ids: string[],
  struct: StructEdge[],
  rank: Map<string, number>,
  present: Map<string, WorkItemBrief>,
): LayeredGraph {
  const ranks = Math.max(...ids.map((id) => rank.get(id) ?? 0)) + 1
  const layers: Slot[][] = Array.from({ length: ranks }, () => [])
  const down = new Map<string, string[]>()
  const up = new Map<string, string[]>()
  const link = (from: string, to: string) => {
    down.set(from, [...(down.get(from) ?? []), to])
    up.set(to, [...(up.get(to) ?? []), from])
  }
  const slotRank = new Map<string, number>()
  for (const id of ids) slotRank.set(id, rank.get(id) ?? 0)
  let dummySeq = 0
  for (const edge of struct) {
    const from = rank.get(edge.source) ?? 0
    const to = rank.get(edge.target) ?? 0
    const chain = [edge.source]
    for (let level = from + 1; level < to; level++) {
      const dummy = dummyId(dummySeq++)
      slotRank.set(dummy, level)
      chain.push(dummy)
    }
    chain.push(edge.target)
    for (let step = 0; step + 1 < chain.length; step++) link(chain[step], chain[step + 1])
  }

  const visitOrder = new Map<string, number>()
  let sequence = 0
  const visit = (id: string) => {
    if (visitOrder.has(id)) return
    visitOrder.set(id, sequence++)
    for (const next of down.get(id) ?? []) visit(next)
  }
  for (const id of ids) if (!(up.get(id) ?? []).length) visit(id)
  for (const id of ids) visit(id)
  for (const id of slotRank.keys()) {
    layers[slotRank.get(id) ?? 0].push({ id, node: present.get(id) ?? null })
  }
  for (const layer of layers) {
    layer.sort(
      (left, right) =>
        (visitOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
        (visitOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    )
  }
  return { layers, down, up, slotRank }
}

/**
 * Barycenter sweeps with a transpose pass, keeping the best order by crossing
 * count; four fruitless sweeps end the search. This is the dot/dagre recipe.
 *
 * `layers` is reordered in place, which is what the caller wants: the layer a
 * slot belongs to never changes here, only its position inside that layer.
 */
function orderLayers(graph: LayeredGraph): void {
  const { layers, down, up } = graph
  const position = new Map<string, number>()
  const reindex = () => {
    for (const layer of layers)
      for (const [index, slot] of layer.entries()) position.set(slot.id, index)
  }
  reindex()

  // A swap only disturbs the two gaps around its layer, so the transpose
  // pass scores those alone instead of recounting the whole field.
  const crossingsAt = (level: number): number => {
    if (level < 0 || level + 1 >= layers.length) return 0
    const segments: Array<[number, number]> = []
    for (const slot of layers[level]) {
      for (const target of down.get(slot.id) ?? []) {
        segments.push([position.get(slot.id) ?? 0, position.get(target) ?? 0])
      }
    }
    let total = 0
    for (let one = 0; one < segments.length; one++) {
      for (let two = one + 1; two < segments.length; two++) {
        if ((segments[one][0] - segments[two][0]) * (segments[one][1] - segments[two][1]) < 0) {
          total++
        }
      }
    }
    return total
  }
  const countCrossings = (): number => {
    let total = 0
    for (let level = 0; level + 1 < layers.length; level++) total += crossingsAt(level)
    return total
  }
  const sortLayer = (layer: Slot[], reference: Map<string, string[]>) => {
    const keyed = layer.map((slot) => {
      const neighbors = (reference.get(slot.id) ?? []).map((id) => position.get(id) ?? 0)
      return {
        slot,
        key: neighbors.length
          ? neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length
          : (position.get(slot.id) ?? 0),
      }
    })
    keyed.sort((left, right) => left.key - right.key)
    layer.splice(0, layer.length, ...keyed.map((entry) => entry.slot))
  }
  const swap = (layer: Slot[], index: number) => {
    // eslint-disable-next-line unicorn/no-unreadable-array-destructuring -- the canonical two-element swap
    ;[layer[index], layer[index + 1]] = [layer[index + 1], layer[index]]
    position.set(layer[index].id, index)
    position.set(layer[index + 1].id, index + 1)
  }
  /** One transpose round; true when any swap removed a crossing. */
  const transposeRound = (): boolean => {
    let improved = false
    for (const [level, layer] of layers.entries()) {
      for (let index = 0; index + 1 < layer.length; index++) {
        const before = crossingsAt(level - 1) + crossingsAt(level)
        swap(layer, index)
        if (crossingsAt(level - 1) + crossingsAt(level) < before) improved = true
        else swap(layer, index)
      }
    }
    return improved
  }
  const transpose = () => {
    for (let round = 0; round < 4; round++) if (!transposeRound()) return
  }
  const sweep = (index: number) => {
    if (index % 2 === 0) {
      for (let level = 1; level < layers.length; level++) sortLayer(layers[level], up)
    } else {
      for (let level = layers.length - 2; level >= 0; level--) sortLayer(layers[level], down)
    }
    reindex()
    transpose()
  }

  let best = layers.map((layer) => [...layer])
  let bestCrossings = countCrossings()
  let idle = 0
  for (let index = 0; index < MAX_SWEEPS && bestCrossings > 0 && idle < PATIENCE; index++) {
    sweep(index)
    const crossings = countCrossings()
    if (crossings < bestCrossings) {
      bestCrossings = crossings
      best = layers.map((layer) => [...layer])
      idle = 0
    } else {
      idle++
    }
  }
  layers.splice(0, layers.length, ...best)
}

/**
 * A row offset per slot: start at the order index, then let every slot drift
 * toward the median of its neighbors without passing the slot above, so chains
 * straighten while the layer order stays intact.
 *
 * The median passes only ever push rows down and can leave whole bands empty
 * across every column, so the last step collapses those: the top row is pinned
 * to zero and a blank strip shrinks to a single row of air.
 */
function assignRows(graph: LayeredGraph): Map<string, number> {
  const { layers, down, up } = graph
  const rowY = new Map<string, number>()
  for (const layer of layers) {
    for (const [index, slot] of layer.entries()) rowY.set(slot.id, index * ROW_HEIGHT)
  }
  const alignLayer = (layer: Slot[], reference: Map<string, string[]>) => {
    let floor = 0
    for (const slot of layer) {
      const anchors = (reference.get(slot.id) ?? []).map((id) => rowY.get(id) ?? 0)
      const desired = anchors.length ? median(anchors) : (rowY.get(slot.id) ?? 0)
      const value = Math.max(desired, floor)
      rowY.set(slot.id, value)
      floor = value + ROW_HEIGHT
    }
  }
  for (let level = 1; level < layers.length; level++) alignLayer(layers[level], up)
  for (let level = layers.length - 2; level >= 0; level--) alignLayer(layers[level], down)
  for (let level = 1; level < layers.length; level++) alignLayer(layers[level], up)

  const bands = [...new Set(rowY.values())].sort((left, right) => left - right)
  const remap = new Map<number, number>()
  let compact = 0
  for (const [index, band] of bands.entries()) {
    if (index > 0) compact += Math.min(band - bands[index - 1], ROW_HEIGHT)
    remap.set(band, compact)
  }
  for (const [id, value] of rowY) rowY.set(id, remap.get(value) ?? value)
  return rowY
}

export function layoutComponent(
  componentNodes: WorkItemBrief[],
  componentEdges: PlanningEdge[],
): ComponentLayout {
  const ids = componentNodes.map((node) => node.work_item_id)
  const present = new Map(componentNodes.map((node) => [node.work_item_id, node]))
  const struct = orientAcyclic(ids, componentEdges)
  const rank = rankNodes(ids, struct)

  const graph = buildLayers(ids, struct, rank, present)
  orderLayers(graph)
  const rowY = assignRows(graph)

  const nodes: PlacedNode[] = componentNodes.map((node) => ({
    ...node,
    x: columnX(graph.slotRank.get(node.work_item_id) ?? 0),
    y: rowY.get(node.work_item_id) ?? 0,
    isolated: false,
  }))
  let height = 0
  for (const value of rowY.values()) height = Math.max(height, value + NODE_HEIGHT)

  // Vue Flow's built-in StraightEdge computes one border-to-border segment.
  // Keep the exact persisted direction and let the renderer handle overlaps.
  const edges: PlanningEdge[] = struct.map((edge) => ({ ...edge.original }))

  return { nodes, edges, ranks: graph.layers.length, height }
}

/** One block of wired work: the nodes of a component and the wires inside it. */
interface Component {
  edges: PlanningEdge[]
  nodes: WorkItemBrief[]
}

/**
 * The nodes the visible wires connect, grouped by component, and the ones no
 * visible wire touches.
 *
 * Union-find over the wires: one root per component. Components come back in a
 * stable order — the one holding the lowest item number first — so the same
 * space always stacks the same way. Numbers order them rather than ids because
 * an id is a UUID, and UUID order is arbitrary to a reader.
 */
export function connectedComponents(
  nodes: WorkItemBrief[],
  visible: PlanningEdge[],
): { components: Component[]; isolated: WorkItemBrief[] } {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = parent.get(id) ?? id
    if (root !== id) {
      root = find(root)
      parent.set(id, root)
    }
    return root
  }
  const union = (left: string, right: string) => {
    const a = find(left)
    const b = find(right)
    if (a !== b) parent.set(a, b)
  }
  for (const edge of visible) {
    if (!parent.has(edge.from)) parent.set(edge.from, edge.from)
    if (!parent.has(edge.to)) parent.set(edge.to, edge.to)
    union(edge.from, edge.to)
  }

  const byComponent = new Map<string, Component>()
  for (const node of nodes) {
    if (!parent.has(node.work_item_id)) continue
    const root = find(node.work_item_id)
    const bucket = byComponent.get(root) ?? { nodes: [], edges: [] }
    bucket.nodes.push(node)
    byComponent.set(root, bucket)
  }
  for (const edge of visible) {
    byComponent.get(find(edge.from))?.edges.push(edge)
  }

  const components = [...byComponent.values()].sort(
    (left, right) =>
      Math.min(...left.nodes.map((node) => node.number)) -
      Math.min(...right.nodes.map((node) => node.number)),
  )
  for (const component of components) component.nodes.sort((a, b) => a.number - b.number)
  return {
    components,
    isolated: nodes.filter((node) => !parent.has(node.work_item_id)).sort(rowOrder),
  }
}

/** The unlinked grid: column-major, wrapping past `ISOLATED_ROWS` rows. */
export function gridRows(nodes: WorkItemBrief[], top: number): PlacedNode[] {
  return nodes.map((node, index) => ({
    ...node,
    x: MARGIN + Math.floor(index / ISOLATED_ROWS) * COLUMN_WIDTH,
    y: top + (index % ISOLATED_ROWS) * ROW_HEIGHT,
    isolated: true,
  }))
}

/**
 * Layered layout over every visible dependency. Every connected component is
 * laid out on its own and the components stack vertically (the ELK
 * separate-components rule) — independent chains must not share rows and tear
 * holes into each other. Items touching no visible dependency are honest
 * inventory, not fake structure: they sit in their own grid below the chains.
 */
