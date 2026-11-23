/**
 * How many columns a wrapping row of segments stands in. The widths are hand-made: a gap of
 * 2px, segments whose widest is 100px, and rooms around what two, three or four of them need:
 * two columns take 202px, three 304px and four 406px.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { segmentColumns } from '@/shared/ui/segmentColumns.ts'

const row = { gap: 2, widest: 100 }

test('a row whose one line fits its room stays that line', () => {
  assert.equal(segmentColumns({ ...row, count: 4, line: 400, room: 400 }), 4)
})

test('a wrapped row of four stands two to a line where two columns fit', () => {
  assert.equal(segmentColumns({ ...row, count: 4, line: 410, room: 202 }), 2)
})

test('a count the columns divide fills every line: four never stand three over one', () => {
  // Three columns fit 320px, but two over two is as few lines and leaves none short.
  assert.equal(segmentColumns({ ...row, count: 4, line: 410, room: 320 }), 2)
  // Four columns would fit 420px too, but the row wrapped, so it is two lines of two.
  assert.equal(segmentColumns({ ...row, count: 4, line: 430, room: 420 }), 2)
  assert.equal(segmentColumns({ ...row, count: 6, line: 610, room: 320 }), 3)
  assert.equal(segmentColumns({ ...row, count: 6, line: 610, room: 420 }), 3)
})

test('a count no columns divide stands on the fewest lines, the last one shorter', () => {
  // Five in room for three or four stand three over two, not four over one.
  assert.equal(segmentColumns({ ...row, count: 5, line: 510, room: 320 }), 3)
  assert.equal(segmentColumns({ ...row, count: 5, line: 510, room: 450 }), 3)
  // Five in room for two stand two, two and one.
  assert.equal(segmentColumns({ ...row, count: 5, line: 510, room: 250 }), 2)
  // Three in room for two stand two over one.
  assert.equal(segmentColumns({ ...row, count: 3, line: 310, room: 250 }), 2)
})

test('one column where not even two fit', () => {
  assert.equal(segmentColumns({ ...row, count: 4, line: 410, room: 201 }), 1)
  assert.equal(segmentColumns({ ...row, count: 5, line: 510, room: 201 }), 1)
  assert.equal(segmentColumns({ ...row, count: 2, line: 210, room: 200 }), 1)
})
