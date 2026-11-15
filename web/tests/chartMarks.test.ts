/**
 * What a mark of the period chart says and does: its hint, the element it is drawn as, and where
 * the keyboard goes from it. Each expectation is worked out by hand from the data in the test.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import type { PeriodSeries } from '@/shared/ui/chartGeometry.ts'
import {
  columnNotes,
  columnSummary,
  markActs,
  markTag,
  nextCursor,
  segmentSummary,
  shareWords,
  stackColumns,
} from '@/shared/ui/chartGeometry.ts'
import { namedHint, periodHint, seriesHint } from '@/shared/ui/markHints.ts'

import { column, series, words } from './fixtures/periodChart.ts'

const percent = (ratio: number) => `${Math.round(ratio * 100)}% of the total`
const every = () => true
const bOnly = (segment: { series: PeriodSeries }) => segment.series.key === 'b'

describe('the hint of a mark', () => {
  test('of a period: its sum against the period before, what is said of it, its series largest first', () => {
    const said = { ...words, before: 'period before' }
    const { columns } = stackColumns(
      [{ ...column('d1', { a: 1, b: 4, c: 2 }, true), before: 9 }],
      series,
      [{ at: 'd1', label: 'Switched to B' }],
    )
    const [one] = columns
    assert.ok(one)
    // Each fact a line of its own; «so far» qualifies the sum it follows.
    assert.equal(
      periodHint(one, said, String),
      'd1: total 7 so far, period before 9\nSwitched to B\nAccount B 4\nAccount C 2\nAccount A 1',
    )
    // The whole text keeps the stack's order: it is the period's name for assistive technology.
    assert.equal(
      columnSummary(one, said, String),
      'd1: total 7 so far, period before 9; Account A 1, Account B 4, Account C 2. Switched to B',
    )
    const [segment] = one.segments
    assert.ok(segment)
    assert.equal(
      segmentSummary(one, segment, { words: said, formatValue: String }),
      'd1: Account A 1, total 7 so far. Switched to B',
    )
    // The table says the sum in a cell of its own, so its note still says the period is running.
    assert.deepEqual(columnNotes(one, said), ['so far', 'Switched to B'])
  })

  test('of a period with nothing drawn says the period alone, with no empty tail', () => {
    const { columns } = stackColumns([column('d1', {})], series)
    const [one] = columns
    assert.ok(one)
    assert.equal(periodHint(one, words, String), 'd1: total 0')
  })

  // A segment has no hint of its own: its period's says what the segment's did, its share too.
  test('of a period, where its chart says how a share reads: each series with its share of it', () => {
    const { columns } = stackColumns([column('d1', { a: 1, b: 3 }, true)], series)
    const [one] = columns
    assert.ok(one)
    assert.equal(
      periodHint(one, words, String, percent),
      'd1: total 4 so far\nAccount B 3, 75% of the total\nAccount A 1, 25% of the total',
    )
    // With no words for a share, none is said.
    assert.equal(periodHint(one, words, String), 'd1: total 4 so far\nAccount B 3\nAccount A 1')
    // A segment's name says its share as well, between its figure and its period's sum.
    const [first] = one.segments
    assert.ok(first)
    assert.equal(
      segmentSummary(one, first, { words, formatValue: String, formatShare: percent }),
      'd1: Account A 1, 25% of the total, total 4 so far',
    )
  })

  test('of a legend entry: its series over every period, and its share of them all', () => {
    const { columns } = stackColumns([column('d1', { a: 1, b: 3 }), column('d2', { a: 4 })], series)
    assert.equal(seriesHint('a', columns, String, percent), '5, 63% of the total')
    assert.equal(seriesHint('c', columns, String, percent), '0, 0% of the total')
  })

  test('of a mark that prints its name and figure: what the name leaves out and its share', () => {
    const row = { label: 'acc-1f2e', value: 30, detail: 'acc-1f2e-77aa' }
    assert.deepEqual(namedHint(row, 120, percent), {
      text: 'acc-1f2e-77aa\n25% of the total',
      words: 'acc-1f2e',
    })
    // Nothing to add: the hint is the name, shown while the name is cut.
    assert.deepEqual(namedHint({ label: 'opus', value: 3 }, 0, percent), {
      text: '',
      words: 'opus',
    })
    assert.equal(shareWords(1, 0, percent), '')
    assert.equal(shareWords(-1, 4, percent), '0% of the total')
  })
})

describe('what a mark does', () => {
  test('is a link where it leads, a button where it opens, and shows otherwise', () => {
    assert.equal(markTag({ href: '/open/MAIN-1', actionable: true }, 'span'), 'a')
    assert.equal(markTag({ actionable: true }, 'span'), 'button')
    assert.equal(markTag({}, 'div'), 'div')
    assert.equal(markActs({ action: 'Show' }), false)
    assert.equal(markActs({ actionable: true }), true)
  })
})

describe('the keyboard in a chart', () => {
  const { columns } = stackColumns(
    [
      column('d0', { a: 1, b: 1 }),
      column('d1', {}),
      column('d2', { b: 2 }),
      column('d3', { a: 1, b: 1, c: 1 }),
    ],
    series,
  )

  test('walks the periods sideways, stopping at either end, each one a place to stand', () => {
    const at = { column: 1, segment: null }
    assert.deepEqual(nextCursor(columns, at, 'ArrowRight'), { column: 2, segment: null })
    assert.deepEqual(nextCursor(columns, at, 'ArrowLeft'), { column: 0, segment: null })
    assert.deepEqual(nextCursor(columns, { column: 3, segment: null }, 'ArrowRight'), {
      column: 3,
      segment: null,
    })
    assert.deepEqual(nextCursor(columns, at, 'Home'), { column: 0, segment: null })
    assert.deepEqual(nextCursor(columns, at, 'End'), { column: 3, segment: null })
    // Nothing acts: up stays on the period; a key that moves nothing is no move.
    assert.deepEqual(nextCursor(columns, { column: 0, segment: null }, 'ArrowUp'), {
      column: 0,
      segment: null,
    })
    assert.equal(nextCursor(columns, at, 'a'), null)
  })

  test('climbs from a period into the segments that act, and back down to the period', () => {
    assert.deepEqual(nextCursor(columns, { column: 3, segment: null }, 'ArrowUp', bOnly), {
      column: 3,
      segment: 1,
    })
    assert.deepEqual(nextCursor(columns, { column: 3, segment: 1 }, 'ArrowUp', bOnly), {
      column: 3,
      segment: 1,
    })
    assert.deepEqual(nextCursor(columns, { column: 3, segment: 1 }, 'ArrowDown', bOnly), {
      column: 3,
      segment: null,
    })
  })

  test('among segments, keeps to the series, else the nearest that acts, else the period', () => {
    // From series b in d0 to d1, which holds nothing: the period itself.
    assert.deepEqual(nextCursor(columns, { column: 0, segment: 1 }, 'ArrowRight', every), {
      column: 1,
      segment: null,
    })
    // From b in d2 to d3, where b is the second segment.
    assert.deepEqual(nextCursor(columns, { column: 2, segment: 0 }, 'ArrowRight', every), {
      column: 3,
      segment: 1,
    })
    // From c in d3 back to d2, which has no c: the nearest segment below.
    assert.deepEqual(nextCursor(columns, { column: 3, segment: 2 }, 'ArrowLeft', every), {
      column: 2,
      segment: 0,
    })
    assert.deepEqual(nextCursor(columns, { column: 3, segment: 1 }, 'ArrowUp', every), {
      column: 3,
      segment: 2,
    })
    assert.deepEqual(nextCursor(columns, { column: 3, segment: 2 }, 'ArrowUp', every), {
      column: 3,
      segment: 2,
    })
    assert.deepEqual(nextCursor(columns, { column: 3, segment: 0 }, 'ArrowDown', every), {
      column: 3,
      segment: null,
    })
  })
})
