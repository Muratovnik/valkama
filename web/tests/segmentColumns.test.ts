/**
 * How many columns a wrapping row of segments stands in. The widths are hand-made: a gap of
 * 2px, segments whose widest is 100px, and rooms around what two or three of them need.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { segmentColumns } from '@/shared/ui/segmentColumns.ts'

const row = { gap: 2, widest: 100 }

test('a row whose one line fits its room stays that line', () => {
  assert.equal(segmentColumns({ ...row, count: 4, line: 400, room: 400 }), 4)
})

test('a wrapped row of four stands two to a line where two columns fit', () => {
  // Two columns of the widest are 100 + 2 + 100 = 202px.
  assert.equal(segmentColumns({ ...row, count: 4, line: 410, room: 202 }), 2)
})

test('no column count leaves a line short: four never stand three over one', () => {
  // Three columns fit 302px, but three do not fill a second line of four.
  assert.equal(segmentColumns({ ...row, count: 4, line: 410, room: 320 }), 2)
  assert.equal(segmentColumns({ ...row, count: 6, line: 610, room: 320 }), 3)
})

test('one column where no count that fills every line fits', () => {
  // Two columns need 202px; a prime count has no column count but one and itself.
  assert.equal(segmentColumns({ ...row, count: 4, line: 410, room: 201 }), 1)
  assert.equal(segmentColumns({ ...row, count: 5, line: 510, room: 450 }), 1)
  assert.equal(segmentColumns({ ...row, count: 2, line: 210, room: 200 }), 1)
})
