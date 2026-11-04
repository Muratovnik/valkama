/**
 * A space laid out as frames in one ELK call: every line routed between its
 * own ends, every card inside its frame, frames of one level apart, a field
 * near the window's shape, and the same answer for the same space.
 */
import type { ElkNode } from 'elkjs/lib/elk-api'
import ELK from 'elkjs/lib/elk.bundled.js'
import { describe, expect, it } from 'vitest'

import { frameProjection } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import { NO_EPIC_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { layout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import {
  FRAME_OPTIONS,
  frameGraph,
  HIERARCHY_OPTIONS,
  ROOT_OPTIONS,
} from '@/widgets/work-item-graph/utils/graphLayoutTree.ts'

import { broadSpace, deepSpace } from './fixtures/graphSpaces.ts'

const engine = new ELK()
type Box = { height: number; width: number; x: number; y: number }

const within = (inner: Box, outer: Box) =>
  inner.x >= outer.x - 0.5 &&
  inner.y >= outer.y - 0.5 &&
  inner.x + inner.width <= outer.x + outer.width + 0.5 &&
  inner.y + inner.height <= outer.y + outer.height + 0.5

const apart = (left: Box, right: Box) =>
  left.x + left.width <= right.x ||
  right.x + right.width <= left.x ||
  left.y + left.height <= right.y ||
  right.y + right.height <= left.y

/** Whether a point lies on a box's border, give or take half a pixel. */
function onBorder(point: { x: number; y: number }, box: Box) {
  const inside = within({ ...point, width: 0, height: 0 }, box)
  const edge =
    Math.abs(point.x - box.x) < 0.5 ||
    Math.abs(point.x - box.x - box.width) < 0.5 ||
    Math.abs(point.y - box.y) < 0.5 ||
    Math.abs(point.y - box.y - box.height) < 0.5
  return inside && edge
}

function boxes(placed: GraphLayout): Map<string, Box> {
  return new Map<string, Box>([
    ...placed.nodes.map((node) => [node.work_item_id, node] as const),
    ...placed.frames.map((frame) => [frame.id, frame] as const),
  ])
}

const spaces = [
  ['broad', broadSpace],
  ['deep', deepSpace],
] as const

describe.each(spaces)('the %s space laid out as frames', (_, make) => {
  const { model } = make()
  const source = { nodes: model.work_items, edges: model.links }
  const placed = layout(source, engine)

  it('routes every drawn line from its source to its target', async () => {
    const field = await placed
    const projected = frameProjection({
      items: model.work_items,
      links: model.links,
      showDone: false,
    })
    expect(field.edges.map((edge) => edge.id)).toEqual(projected.edges.map((edge) => edge.id))
    expect(field.edges.length).toBeGreaterThan(10)
    const at = boxes(field)
    for (const edge of field.edges) {
      const source = at.get(edge.source)
      const target = at.get(edge.target)
      expect(source && target, edge.id).toBeTruthy()
      if (!source || !target) continue
      expect(onBorder(edge.points[0], source), `${edge.id} starts on its source`).toBe(true)
      expect(
        onBorder(edge.points.at(-1) ?? edge.points[0], target),
        `${edge.id} ends on its target`,
      ).toBe(true)
    }
  })

  it('keeps every card inside its frame and every nested frame inside its own', async () => {
    const field = await placed
    const frames = new Map(field.frames.map((frame) => [frame.id, frame]))
    for (const node of field.nodes) {
      const frame = frames.get(node.frameId)
      expect(frame?.folded, node.reference).toBe(false)
      if (frame) expect(within(node, frame), node.reference).toBe(true)
    }
    for (const frame of field.frames) {
      const parent = frame.parentId === null ? undefined : frames.get(frame.parentId)
      if (parent) expect(within(frame, parent), frame.id).toBe(true)
    }
  })

  it('keeps frames of one level and the cards of one frame apart', async () => {
    const field = await placed
    const groups = new Map<string, Box[]>()
    for (const frame of field.frames)
      groups.set(`frame:${frame.parentId}`, [
        ...(groups.get(`frame:${frame.parentId}`) ?? []),
        frame,
      ])
    for (const node of field.nodes)
      groups.set(`card:${node.frameId}`, [...(groups.get(`card:${node.frameId}`) ?? []), node])
    for (const [group, members] of groups)
      for (const [index, left] of members.entries())
        for (const right of members.slice(index + 1)) expect(apart(left, right), group).toBe(true)
  })

  it('draws a field no narrower than 0.8 and no wider than 3 to 1', async () => {
    const field = await placed
    const ratio = field.width / field.height
    expect(ratio, `${field.width}×${field.height}`).toBeGreaterThan(0.8)
    expect(ratio, `${field.width}×${field.height}`).toBeLessThan(3)
  })

  it('lays the same space out the same, whatever order it arrived in', async () => {
    const shuffled = { nodes: [...source.nodes].reverse(), edges: [...source.edges].reverse() }
    expect(await layout(shuffled, engine)).toEqual(await placed)
  })
})

describe('lines to an epic', () => {
  it('route a link from open work to another epic up to that epic’s frame', async () => {
    const { model, epics } = broadSpace()
    const field = await layout({ nodes: model.work_items, edges: model.links }, engine)
    const epicIds = new Set(epics.map((epic) => epic.work_item_id))
    const frames = new Map(field.frames.map((frame) => [frame.id, frame]))
    const toEpic = field.edges.filter((edge) => epicIds.has(edge.target))
    expect(toEpic.length).toBeGreaterThan(0)
    for (const edge of toEpic) {
      const frame = frames.get(edge.target)
      expect(frame, edge.id).toBeDefined()
      if (frame) expect(onBorder(edge.points.at(-1) ?? edge.points[0], frame), edge.id).toBe(true)
    }
  })
})

describe('the options a hierarchical layout is given', () => {
  /** Every node of a graph, however deep. */
  const all = (node: ElkNode): ElkNode[] => [
    node,
    ...(node.children ?? []).flatMap((child) => all(child)),
  ]

  it('never include an option that ends a hierarchical layout', () => {
    for (const options of [ROOT_OPTIONS, HIERARCHY_OPTIONS, FRAME_OPTIONS]) {
      const keys = Object.keys(options).join(' ')
      expect(keys).not.toMatch(/considerModelOrder|wrapping/u)
    }
    const { model } = broadSpace()
    const graph = frameGraph(
      frameProjection({ items: model.work_items, links: model.links, showDone: true, choices: {} }),
    )
    const hierarchical = all(graph).filter(
      (node) => node.layoutOptions?.['elk.hierarchyHandling'] === 'INCLUDE_CHILDREN',
    )
    expect(hierarchical.length).toBeGreaterThan(10)
    for (const node of all(graph)) {
      expect(Object.keys(node.layoutOptions ?? {}).join(' '), node.id).not.toMatch(
        /considerModelOrder|wrapping/u,
      )
    }
  })

  it('lay out a space of frames, folded and open, nested and loose, without failing', async () => {
    const { model } = broadSpace()
    const open = Object.fromEntries(
      frameProjection({ items: model.work_items, links: model.links, showDone: true }).frames.map(
        (frame) => [frame.id, frame.id === NO_EPIC_FRAME],
      ),
    )
    const field = await layout({ nodes: model.work_items, edges: model.links }, engine, true, {
      kind: 'all',
      epicId: null,
      frames: { choices: open },
    })
    expect(field.frames.some((frame) => frame.parentId !== null)).toBe(true)
    expect(field.frames.some((frame) => frame.folded)).toBe(true)
    expect(field.nodes.length).toBeGreaterThan(500)
  }, 30_000)
})
