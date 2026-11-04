/**
 * The laid-out field as Vue Flow receives it: frames under the lines, cards
 * over them, every node a place the layout sized, and nothing on a node that a
 * frame of the stream changes without moving it.
 */
import { shallowRef } from 'vue'

import { describe, expect, it } from 'vitest'

import { useGraphFlowElements } from '@/widgets/work-item-graph/composables/useGraphFlowElements.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import { placedSample } from './fixtures/graphSample.ts'

function elements(layout: GraphLayout) {
  return useGraphFlowElements({ focusSet: shallowRef(null), placed: shallowRef(layout) })
}

describe("the field's Vue Flow nodes", () => {
  it('lays every frame below the lines and every card above them', () => {
    const layout = placedSample()
    const { nodes } = elements(layout)
    const frames = nodes.value.filter((node) => node.type === 'frame')
    const cards = nodes.value.filter((node) => node.type === 'card')
    expect(frames.map((node) => node.id)).toEqual(layout.frames.map((frame) => frame.id))
    expect(cards.map((node) => node.id)).toEqual(layout.nodes.map((node) => node.work_item_id))
    // Vue Flow draws a line at zero: a frame under it, a card at it and after it.
    for (const frame of frames) expect(frame.zIndex).toBeLessThan(0)
    for (const card of cards) expect(card.zIndex ?? 0).toBe(0)
  })

  it('lays a frame inside a frame one step above the one it stands in', () => {
    const layout = placedSample()
    const [outer] = layout.frames
    const inner = { ...layout.frames[1], parentId: outer.id }
    const { nodes } = elements({ ...layout, frames: [inner, outer, layout.frames[2]] })
    const z = (id: string) => nodes.value.find((node) => node.id === id)?.zIndex ?? 0
    expect(z(inner.id)).toBe(z(outer.id) + 1)
  })

  it('sizes each node by the box the layout gave it', () => {
    const layout = placedSample()
    const { nodes } = elements(layout)
    const folded = layout.frames[1]
    const node = nodes.value.find((each) => each.id === folded.id)
    expect(node).toMatchObject({
      position: { x: folded.x, y: folded.y },
      width: folded.width,
      height: folded.height,
    })
  })

  it('carries only the id a node is read by, so a changed brief changes no node', () => {
    const layout = placedSample()
    const { nodes } = elements(layout)
    for (const node of nodes.value) expect(node.data).toEqual({ id: node.id })
  })
})

/** Each line of a layout, and whether it runs, while the work in `moving` moves. */
const live = (layout: GraphLayout, moving: string[]) =>
  useGraphFlowElements({
    focusSet: shallowRef(null),
    placed: shallowRef(layout),
    moving: shallowRef(new Set(moving)),
  }).edges.value.map((edge) => ({
    id: edge.id,
    live: (edge.data as { live: boolean }).live,
    marked: (edge.class as string[]).includes('live'),
  }))

describe('the lines live work runs along', () => {
  it('runs a line whose card is being worked on, and no other', () => {
    const layout = placedSample()
    const [inside, folded] = layout.edges
    expect(live(layout, [layout.nodes[0].work_item_id])).toEqual([
      { id: inside.id, live: true, marked: true },
      { id: folded.id, live: false, marked: false },
    ])
  })

  it('runs a line folded onto a frame when work inside the frame moves', () => {
    const layout = placedSample()
    const folded = layout.edges[1]
    // The line ends on the folded frame, and stands for links to work inside it.
    const inside = folded.links[1].to
    expect(live(layout, [inside]).find((edge) => edge.id === folded.id)).toEqual({
      id: folded.id,
      live: true,
      marked: true,
    })
  })

  it('runs nothing while nothing moves', () => {
    expect(live(placedSample(), []).some((edge) => edge.live)).toBe(false)
  })
})

describe("the field's Vue Flow edges", () => {
  it('ends a line on a frame where the layout ended it on one', () => {
    const layout = placedSample()
    const { edges } = elements(layout)
    const folded = layout.edges[1]
    expect(edges.value.find((edge) => edge.id === folded.id)).toMatchObject({
      source: folded.source,
      target: folded.target,
      sourceHandle: 'source',
      targetHandle: 'target',
    })
  })
})
