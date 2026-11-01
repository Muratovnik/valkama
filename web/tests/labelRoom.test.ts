/**
 * How many label chips one line holds. The widths are hand-made: a line of
 * 100px, chips of 30px, a gap of 4px and a «+N» of 16px.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { chipsThatFit } from '@/entities/work-item/utils/labelRoom.ts'

const line = { gap: 4, line: 100, more: 16 }

test('every chip fits when they and their gaps fill the line, with no count to make room for', () => {
  // 30 + 4 + 30 + 4 + 30 = 98 ≤ 100, and no label is left out.
  assert.equal(chipsThatFit({ ...line, chips: [30, 30, 30], total: 3 }), 3)
})

test('a chip gives way to the count of what is left out', () => {
  // Three chips are 98px, but a fourth label needs «+1» after them: 98 + 4 + 16 > 100.
  // Two are 64px, and 64 + 4 + 16 = 84 leaves the count its room.
  assert.equal(chipsThatFit({ ...line, chips: [30, 30, 30], total: 4 }), 2)
})

test('chips keep their order: a short one later does not jump a long one', () => {
  assert.equal(chipsThatFit({ ...line, chips: [30, 70, 10], total: 3 }), 1)
})

test('one chip shows, shortened, when not even it fits beside the count', () => {
  assert.equal(chipsThatFit({ ...line, chips: [120, 10], total: 2 }), 1)
  assert.equal(chipsThatFit({ ...line, chips: [], total: 0 }), 1)
})
