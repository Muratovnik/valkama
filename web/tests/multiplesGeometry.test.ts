/**
 * The numbers the small multiples draw. Each expectation is worked out by hand from the data in
 * the test: one scale for every chart, its top the round step at or past the largest period of a
 * category or the folded tail, each column that period over the top; work with no value and
 * unknown work apart, after the rest, setting no scale and drawing no column.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { placeMultiples } from '@/shared/ui/multiplesGeometry.ts'
import type { SmallMultiple } from '@/shared/ui/multiplesGeometry.ts'

const multiple = (
  key: string,
  values: (number | null)[],
  kind?: SmallMultiple['kind'],
): SmallMultiple => ({ key, label: key, values, valueText: key, ...(kind ? { kind } : {}) })

describe('small multiples', () => {
  test('share one scale, whose top is the round step past the largest period', () => {
    const { shared, apart, top } = placeMultiples([
      multiple('none', [100, 100], 'none'),
      multiple('other', [20, 0], 'other'),
      multiple('a', [10, 35]),
      multiple('unknown', [50, null], 'unknown'),
      multiple('b', [5, null]),
    ])
    // 35 over about four steps is 8.75 a step, rounded to 10: the top is 40, not 35, and not
    // the 100 of work with no value, which takes no part in the scale.
    assert.equal(top, 40)
    assert.deepEqual(
      shared.map((one) => [one.key, one.kind, one.heights]),
      [
        ['a', 'category', [0.25, 0.875]],
        ['b', 'category', [0.125, null]],
        ['other', 'other', [0.5, 0]],
      ],
    )
    assert.deepEqual(
      apart.map((one) => [one.key, one.kind, one.heights]),
      [
        ['none', 'none', []],
        ['unknown', 'unknown', []],
      ],
    )
  })

  test('draw nothing tall when nothing was spent, and keep a period with no figure apart', () => {
    const { shared, top } = placeMultiples([multiple('a', [0, null, -3])])
    assert.equal(top, 0)
    assert.deepEqual(shared[0]?.heights, [0, null, 0])
  })
})
