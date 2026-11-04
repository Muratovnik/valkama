import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  NO_EPIC_FRAME,
  NODE_HEIGHT,
  NODE_WIDTH,
} from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedFrame, PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import {
  foldTarget,
  frameTarget,
  graphWalk,
  isGraphWalkKey,
  nodeCentre,
  walkTargets,
} from '@/widgets/work-item-graph/utils/graphWalk.ts'

import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'

import { workItem } from './browser/planningFixtures.ts'

// A graph node is a brief, and a brief always carries its comment count.
const base = { ...validateWorkItemRecord(workItem), comment_count: 0 }
const COLUMN = NODE_WIDTH + 64
const ROW = NODE_HEIGHT + 36

/** One node at a grid place: column `c`, row `r`. */
function at(id: string, c: number, r: number): PlacedNode {
  return {
    ...base,
    work_item_id: id,
    x: c * COLUMN,
    y: r * ROW,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    frameId: NO_EPIC_FRAME,
  }
}

/** The keyboard's targets on a field of cards and no frames. */
const cards = (...nodes: PlacedNode[]) => walkTargets({ nodes, frames: [] })

// A  B  .  D
// .  C  .  E
//          F
const field = cards(
  at('A', 0, 0),
  at('B', 1, 0),
  at('C', 1, 1),
  at('D', 3, 0),
  at('E', 3, 1),
  at('F', 3, 2),
)

test('an arrow goes to the nearest node that way and keeps to its line before it turns', () => {
  assert.equal(graphWalk(field, 'A', 'ArrowRight'), 'B')
  // Two columns on along the row beats one column on and a row down.
  assert.equal(graphWalk(field, 'B', 'ArrowRight'), 'D')
  assert.equal(graphWalk(field, 'C', 'ArrowRight'), 'E')
  assert.equal(graphWalk(field, 'D', 'ArrowDown'), 'E')
  assert.equal(graphWalk(field, 'E', 'ArrowDown'), 'F')
  assert.equal(graphWalk(field, 'C', 'ArrowUp'), 'B')
  assert.equal(graphWalk(field, 'C', 'ArrowLeft'), 'A')
})

test('an arrow with nothing that way stays put rather than wrapping', () => {
  assert.equal(graphWalk(field, 'A', 'ArrowLeft'), null)
  assert.equal(graphWalk(field, 'A', 'ArrowUp'), null)
  assert.equal(graphWalk(field, 'F', 'ArrowDown'), null)
  // A node level with this one is not "below" it.
  assert.equal(graphWalk(cards(at('A', 0, 0), at('B', 1, 0)), 'A', 'ArrowDown'), null)
})

test('Home and End go to the first and the last node as the field is read', () => {
  assert.equal(graphWalk(field, 'E', 'Home'), 'A')
  assert.equal(graphWalk(field, 'A', 'End'), 'F')
  // Top to bottom first: a node further right on an earlier row still comes first.
  assert.equal(graphWalk(cards(at('X', 0, 1), at('Y', 5, 0)), 'X', 'Home'), 'Y')
  assert.equal(graphWalk([], 'A', 'Home'), null)
})

test('only the walk keys walk', () => {
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])
    assert.ok(isGraphWalkKey(key), key)
  for (const key of ['Enter', ' ', 'Tab', 'PageDown', 'a']) assert.equal(isGraphWalkKey(key), false)
})

/** A frame round its work, open or folded, at a box of the field. */
function frame(
  id: string,
  box: Pick<PlacedFrame, 'height' | 'width' | 'x' | 'y'>,
  folded = false,
): PlacedFrame {
  return {
    id,
    epic: id === NO_EPIC_FRAME ? null : { ...base, work_item_id: id },
    parentId: null,
    folded,
    ...box,
    progress: { active: 0, ahead: 2, blocked: 0, done: 0, review: 0, total: 2 },
    members: [],
  }
}

// One open frame round two cards, a folded frame to its right, and the work
// under none folded below that.
const framed = walkTargets({
  frames: [
    frame('E', { x: 0, y: 0, width: 640, height: 200 }),
    frame('G', { x: 700, y: 0, width: 288, height: 72 }, true),
    frame(NO_EPIC_FRAME, { x: 700, y: 120, width: 288, height: 72 }, true),
  ],
  nodes: [
    { ...at('P', 0, 0), x: 16, y: 72, frameId: 'E' },
    { ...at('Q', 0, 0), x: 360, y: 72, frameId: 'E' },
  ],
})

test('a frame header has a fold and an open target, and the work under none only a fold', () => {
  assert.deepEqual(
    framed.map((target) => target.id),
    [
      foldTarget('E'),
      frameTarget('E'),
      foldTarget('G'),
      frameTarget('G'),
      foldTarget(NO_EPIC_FRAME),
      'P',
      'Q',
    ],
  )
})

test('the centre of a header target is the centre of its own box, not of a card', () => {
  const folded = framed.find((target) => target.id === frameTarget('G'))
  assert.ok(folded)
  assert.deepEqual(nodeCentre(folded), { x: 700 + 44 + (288 - 44) / 2, y: 36 })
  const open = framed.find((target) => target.id === foldTarget('E'))
  assert.ok(open)
  assert.deepEqual(nodeCentre(open), { x: 22, y: 28 })
})

test('from a card the arrows reach its frame header, and along the header from fold to open', () => {
  const up = graphWalk(framed, 'P', 'ArrowUp')
  assert.ok(up === foldTarget('E') || up === frameTarget('E'), String(up))
  assert.equal(graphWalk(framed, foldTarget('E'), 'ArrowRight'), frameTarget('E'))
  assert.equal(graphWalk(framed, frameTarget('E'), 'ArrowLeft'), foldTarget('E'))
  assert.equal(graphWalk(framed, foldTarget(NO_EPIC_FRAME), 'ArrowUp'), foldTarget('G'))
})

test("Home goes to the first target as the field is read: the first frame's fold", () => {
  assert.equal(graphWalk(framed, 'Q', 'Home'), foldTarget('E'))
  assert.equal(graphWalk(framed, foldTarget('E'), 'End'), foldTarget(NO_EPIC_FRAME))
})

// A frame as wide as a long row of work: its open target's centre stands far to
// the right of its fold, further than the first card under the fold.
const wide = walkTargets({
  frames: [frame('W', { x: 0, y: 0, width: 1248, height: 948 })],
  nodes: [{ ...at('R', 0, 0), x: 16, y: 72, frameId: 'W' }],
})

test('along a header the arrows go from fold to open and back, however wide the header', () => {
  assert.equal(graphWalk(wide, foldTarget('W'), 'ArrowRight'), frameTarget('W'))
  assert.equal(graphWalk(wide, frameTarget('W'), 'ArrowLeft'), foldTarget('W'))
  // Down from the fold is still the card under it.
  assert.equal(graphWalk(wide, foldTarget('W'), 'ArrowDown'), 'R')
})

test('zoomed out to the overview, an epic header has no fold target, and the work under none keeps it', () => {
  const graph = {
    frames: [
      frame('E', { x: 0, y: 0, width: 640, height: 200 }),
      frame(NO_EPIC_FRAME, { x: 700, y: 0, width: 288, height: 72 }, true),
    ],
    nodes: [{ ...at('P', 0, 0), x: 16, y: 72, frameId: 'E' }],
  }
  // The work under none has no other button in its header: it keeps its fold,
  // or a field of it alone would take no focus at all.
  assert.deepEqual(
    walkTargets(graph, { overview: true }).map((target) => target.id),
    [frameTarget('E'), foldTarget(NO_EPIC_FRAME), 'P'],
  )
  assert.deepEqual(
    walkTargets(graph, { overview: false }).map((target) => target.id),
    walkTargets(graph).map((target) => target.id),
  )
})
