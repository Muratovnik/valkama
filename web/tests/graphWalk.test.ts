import assert from 'node:assert/strict'

import { test } from 'vitest'

import { NODE_HEIGHT, NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { graphWalk, isGraphWalkKey } from '@/widgets/work-item-graph/utils/graphWalk.ts'

import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'

import { workItem } from './browser/planningFixtures.ts'

const base = validateWorkItemRecord(workItem)
const COLUMN = NODE_WIDTH + 64
const ROW = NODE_HEIGHT + 36

/** One node at a grid place: column `c`, row `r`. */
function at(id: string, c: number, r: number): PlacedNode {
  return { ...base, work_item_id: id, isolated: false, x: c * COLUMN, y: r * ROW }
}

// A  B  .  D
// .  C  .  E
//          F
const field = [
  at('A', 0, 0),
  at('B', 1, 0),
  at('C', 1, 1),
  at('D', 3, 0),
  at('E', 3, 1),
  at('F', 3, 2),
]

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
  assert.equal(graphWalk([at('A', 0, 0), at('B', 1, 0)], 'A', 'ArrowDown'), null)
})

test('Home and End go to the first and the last node as the field is read', () => {
  assert.equal(graphWalk(field, 'E', 'Home'), 'A')
  assert.equal(graphWalk(field, 'A', 'End'), 'F')
  // Top to bottom first: a node further right on an earlier row still comes first.
  assert.equal(graphWalk([at('X', 0, 1), at('Y', 5, 0)], 'X', 'Home'), 'Y')
  assert.equal(graphWalk([], 'A', 'Home'), null)
})

test('only the walk keys walk', () => {
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])
    assert.ok(isGraphWalkKey(key), key)
  for (const key of ['Enter', ' ', 'Tab', 'PageDown', 'a']) assert.equal(isGraphWalkKey(key), false)
})
