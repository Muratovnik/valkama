/**
 * The ranked bars' numbers. Each expectation is worked out by hand from the data in the test,
 * not read back from the module: a bar as long as its value over the longest, and the rows that
 * are not categories always at the end.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import { rankRows } from '@/shared/ui/chartGeometry.ts'

const row = (key: string, value: number, kind?: RankedRow['kind']): RankedRow => ({
  key,
  label: key,
  value,
  valueText: String(value),
  ...(kind ? { kind } : {}),
})

describe('ranked rows', () => {
  test('categories stand largest first, and a bar is its value over the longest', () => {
    const { ranked } = rankRows([row('b', 30), row('a', 120), row('c', 60)])
    assert.deepEqual(
      ranked.map((one) => [one.key, one.length]),
      [
        ['a', 1],
        ['c', 0.5],
        ['b', 0.25],
      ],
    )
  })

  test('the rows that are not categories close the chart in one order, however large', () => {
    const { ranked, rest } = rankRows([
      row('unknown', 5, 'unknown'),
      row('a', 10),
      row('none', 7, 'none'),
      row('other', 400, 'other'),
      row('b', 20),
    ])
    assert.deepEqual(
      ranked.map((one) => one.key),
      ['b', 'a'],
    )
    assert.deepEqual(
      rest.map((one) => one.key),
      ['other', 'none', 'unknown'],
    )
    // A tail larger than any category sets no scale: the longest category is the whole bar,
    // and the rows that are not categories draw none.
    assert.deepEqual(
      ranked.map((one) => one.length),
      [1, 0.5],
    )
    assert.deepEqual(
      rest.map((one) => one.length),
      [null, null, null],
    )
  })

  test('rows that are not categories alone draw nothing and scale nothing', () => {
    const { ranked, rest } = rankRows([row('none', 7, 'none'), row('other', 3, 'other')])
    assert.deepEqual(ranked, [])
    assert.deepEqual(
      rest.map((one) => [one.key, one.length]),
      [
        ['other', null],
        ['none', null],
      ],
    )
  })

  test('a tie keeps one order whatever order the rows came in', () => {
    const forward = rankRows([row('beta', 5), row('alpha', 5)]).ranked.map((one) => one.key)
    const backward = rankRows([row('alpha', 5), row('beta', 5)]).ranked.map((one) => one.key)
    assert.deepEqual(forward, ['alpha', 'beta'])
    assert.deepEqual(backward, forward)
  })

  test('nothing, one row, and amounts a bar cannot draw', () => {
    assert.deepEqual(rankRows([]), { ranked: [], rest: [] })
    assert.equal(rankRows([row('only', 3)]).ranked[0]?.length, 1)
    const odd = rankRows([row('zero', 0), row('negative', -4), row('nan', Number.NaN)]).ranked
    assert.deepEqual(
      odd.map((one) => one.length),
      [0, 0, 0],
    )
  })
})
