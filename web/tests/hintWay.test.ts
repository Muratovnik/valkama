/**
 * The way from where the pointer left an anchor to the hint it raised, with no page: what a
 * pointer heading for the hint crosses, and what a pointer going elsewhere does not. A rail
 * row's hint stands past the rail, level with the row; a legend entry's stands under it.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { onWayTo } from '@/shared/ui/hintWay.ts'

/** A rail row's hint, past the rail's edge at 260, a line high, level with its row from 474. */
const BESIDE = { left: 266, right: 400, top: 474, bottom: 503 }
/** The point on the row the pointer left from, level with the hint's middle. */
const ROW = { x: 40, y: 488 }

test('straight from a row to its hint beside the list, the pointer is on the way', () => {
  for (const x of [41, 60, 150, 250, 265])
    assert.equal(onWayTo(ROW, BESIDE, { x, y: 488 }), true, `x ${x}`)
  // A little off the straight line, still heading there.
  assert.equal(onWayTo(ROW, BESIDE, { x: 150, y: 482 }), true)
})

test('straight down to the next row, or back the way it came, the pointer is not', () => {
  for (const y of [500, 520, 540]) assert.equal(onWayTo(ROW, BESIDE, { x: 40, y }), false, `y ${y}`)
  assert.equal(onWayTo(ROW, BESIDE, { x: 20, y: 488 }), false)
  // Above the hint's top and below its foot, past the slack the way starts with.
  assert.equal(onWayTo(ROW, BESIDE, { x: 150, y: 470 }), false)
  assert.equal(onWayTo(ROW, BESIDE, { x: 150, y: 505 }), false)
})

test('along a legend to the next entry, past a hint under its own, the pointer is not', () => {
  // The entry's hint stands under it, from its start, 6px off, and runs on 200px past where the
  // pointer left: the first pixels along the legend still head for its far end, 60px on do not.
  const under = { left: 150, right: 400, top: 116, bottom: 150 }
  const left = { x: 200, y: 100 }
  for (const x of [260, 300, 420])
    assert.equal(onWayTo(left, under, { x, y: 100 }), false, `x ${x}`)
  // Down towards it, it is.
  assert.equal(onWayTo(left, under, { x: 205, y: 110 }), true)
})
