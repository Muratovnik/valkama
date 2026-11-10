/**
 * The numbers the two chart primitives draw. Each expectation is worked out by hand from the
 * data in the test, not read back from the module: a bar as long as its value over the longest,
 * a stack whose segments meet end to end and add up to the period's sum, a scale from zero past
 * the tallest column, and the rows that are not categories always at the end.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import type {
  PeriodColumn,
  PeriodSeries,
  PeriodWords,
  RankedRow,
} from '@/shared/ui/chartGeometry.ts'
import {
  changeMarkers,
  changeNotes,
  columnSummary,
  dayTicks,
  labelledColumns,
  nextCursor,
  rankRows,
  segmentPlace,
  stackColumns,
  valueTicks,
} from '@/shared/ui/chartGeometry.ts'

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
    // A tail larger than any category is measured with the rest, and is the longest bar.
    assert.equal(rest[0]?.length, 1)
    assert.equal(ranked[0]?.length, 20 / 400)
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

const series: PeriodSeries[] = [
  { key: 'a', label: 'Account A', slot: 1 },
  { key: 'b', label: 'Account B', slot: 2 },
  { key: 'c', label: 'Account C', slot: 3 },
]
const column = (key: string, values: PeriodColumn['values'], incomplete = false): PeriodColumn => ({
  key,
  label: key,
  values,
  ...(incomplete ? { incomplete } : {}),
})
const words: PeriodWords = {
  total: 'total',
  incomplete: 'so far',
  period: 'Day',
  note: 'Note',
  empty: 'Nothing',
}

describe('stacked columns', () => {
  test("a period's segments meet end to end in the series' order and add up to its sum", () => {
    const { columns } = stackColumns([column('d1', { a: 2, b: 3, c: 1.5 })], series)
    const [one] = columns
    assert.ok(one)
    assert.equal(one.total, 6.5)
    assert.deepEqual(
      one.segments.map((segment) => [segment.series.key, segment.start, segment.end]),
      [
        ['a', 0, 2],
        ['b', 2, 5],
        ['c', 5, 6.5],
      ],
    )
  })

  test('a series with nothing in a period has no segment, and the rest close up', () => {
    const { columns } = stackColumns(
      [column('d1', { a: 0, c: 4 }), column('d2', { b: -2, c: Number.NaN })],
      series,
    )
    assert.deepEqual(
      columns[0]?.segments.map((segment) => [segment.series.key, segment.start, segment.end]),
      [['c', 0, 4]],
    )
    assert.equal(columns[1]?.total, 0)
    assert.deepEqual(columns[1]?.segments, [])
  })

  test('the scale starts at zero and reaches the tallest column on a round step', () => {
    const { ticks, top } = stackColumns(
      [column('d1', { a: 3, b: 4.3 }), column('d2', { a: 1 })],
      series,
    )
    assert.deepEqual(ticks, [0, 2, 4, 6, 8])
    assert.equal(top, 8)
    assert.deepEqual(valueTicks(100), [0, 25, 50, 75, 100])
    assert.deepEqual(valueTicks(1), [0, 0.25, 0.5, 0.75, 1])
    assert.deepEqual(valueTicks(0.3), [0, 0.1, 0.2, 0.3])
  })

  test('no periods, or periods of nothing, stand on a scale of zero alone', () => {
    assert.deepEqual(stackColumns([], series), { columns: [], ticks: [0], top: 1 })
    const empty = stackColumns([column('d1', {})], series)
    assert.deepEqual(empty.ticks, [0])
    assert.equal(empty.top, 1)
  })

  test('a segment above the lowest leaves a gap of ground under it', () => {
    const { columns } = stackColumns([column('d1', { a: 1, b: 3 })], series)
    const [one] = columns
    assert.ok(one)
    assert.deepEqual(segmentPlace(one, 0), { insetBlockEnd: '0%', blockSize: '25%' })
    assert.deepEqual(segmentPlace(one, 1), {
      insetBlockEnd: 'calc(25% + var(--space-half))',
      blockSize: 'max(0px, calc(75% - var(--space-half)))',
    })
  })
})

describe('a period still running', () => {
  test('is drawn at what it holds so far, and says so in its name and under its column', () => {
    const columns = [column('d1', { a: 4 }), column('d2', { a: 6 }), column('d3', { a: 1 }, true)]
    const { columns: stacked, top } = stackColumns(columns, series)
    // Its amount is not projected forward: the column is as tall as what it holds.
    assert.equal(stacked[2]?.total, 1)
    assert.equal(top, 6)
    const [last] = stacked.slice(-1)
    assert.ok(last)
    assert.equal(columnSummary(last, words, String), 'd3: total 1; Account A 1. so far')
    const ticks = dayTicks(columns, 0, words.incomplete)
    assert.deepEqual(ticks.at(-1), {
      key: 'd3',
      text: 'd3',
      offset: 1,
      edge: 'end',
      note: 'so far',
    })
  })

  test('is named on the axis even where the axis has no room for its neighbours', () => {
    const columns = Array.from({ length: 30 }, (_, index) =>
      column(`d${index}`, { a: 1 }, index === 20),
    )
    const named = new Set(dayTicks(columns, 330, words.incomplete).map((tick) => tick.key))
    assert.ok(named.has('d20'))
    assert.ok(named.has('d29'))
  })
})

describe('the time axis', () => {
  test('names the last period always and steps evenly back from it, a few labels at most', () => {
    assert.deepEqual(labelledColumns(30, 330), [5, 13, 21, 29])
    assert.deepEqual(labelledColumns(7, 1200), [0, 1, 2, 3, 4, 5, 6])
    const wide = labelledColumns(90, 1440)
    assert.equal(wide.length, 8)
    assert.equal(wide.at(-1), 89)
  })

  test('a width not yet measured names the first and the last; one period is named once', () => {
    assert.deepEqual(labelledColumns(30, 0), [0, 29])
    assert.deepEqual(labelledColumns(1, 0), [0])
    assert.deepEqual(labelledColumns(0, 500), [])
  })

  test('the first and the last label keep inside the axis, the others stand under their column', () => {
    const columns = Array.from({ length: 4 }, (_, index) => column(`d${index}`, {}))
    assert.deepEqual(
      dayTicks(columns, 1000, '').map((tick) => [tick.edge, tick.offset]),
      [
        ['start', 0],
        ['middle', 1.5 / 4],
        ['middle', 2.5 / 4],
        ['end', 1],
      ],
    )
  })
})

describe('changes marked on the time axis', () => {
  test('are numbered in time order, named in the period they start, and placed at its start', () => {
    const { columns } = stackColumns(
      [column('d1', { a: 1 }), column('d2', { a: 1 }), column('d3', { a: 1 })],
      series,
      [
        { at: 'd3', label: 'Switched to B' },
        { at: 'd2', label: 'Switched to C' },
        { at: 'd3', label: 'Limit reset' },
      ],
    )
    const notes = changeNotes(columns)
    assert.deepEqual(
      notes.map((note) => [note.number, note.period, note.text]),
      [
        [1, 'd2', 'Switched to C'],
        [2, 'd3', 'Switched to B'],
        [3, 'd3', 'Limit reset'],
      ],
    )
    assert.deepEqual(
      changeMarkers(notes, 3).map((marker) => [marker.text, marker.offset]),
      [
        ['1', 1 / 3],
        ['2, 3', 2 / 3],
      ],
    )
    const third = columns[2]
    assert.ok(third)
    assert.equal(
      columnSummary(third, words, String),
      'd3: total 1; Account A 1. Switched to B. Limit reset',
    )
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

  test('walks the periods sideways, stopping at either end', () => {
    const at = { column: 1, segment: null }
    assert.deepEqual(nextCursor(columns, at, 'ArrowRight'), { column: 2, segment: null })
    assert.deepEqual(nextCursor(columns, at, 'ArrowLeft'), { column: 0, segment: null })
    assert.deepEqual(nextCursor(columns, { column: 3, segment: null }, 'ArrowRight'), {
      column: 3,
      segment: null,
    })
    assert.deepEqual(nextCursor(columns, at, 'Home'), { column: 0, segment: null })
    assert.deepEqual(nextCursor(columns, at, 'End'), { column: 3, segment: null })
    assert.equal(nextCursor(columns, at, 'ArrowUp'), null)
    assert.equal(nextCursor(columns, at, 'a'), null)
  })

  test('among segments, keeps to the series, passes over an empty period, and climbs the stack', () => {
    // From series b in d0 (its second segment): d1 is empty, d2 holds b as its only segment.
    assert.deepEqual(nextCursor(columns, { column: 0, segment: 1 }, 'ArrowRight'), {
      column: 2,
      segment: 0,
    })
    // From b in d2 to d3, where b is the second segment.
    assert.deepEqual(nextCursor(columns, { column: 2, segment: 0 }, 'ArrowRight'), {
      column: 3,
      segment: 1,
    })
    // From c in d3 back to d2, which has no c: the nearest segment.
    assert.deepEqual(nextCursor(columns, { column: 3, segment: 2 }, 'ArrowLeft'), {
      column: 2,
      segment: 0,
    })
    assert.deepEqual(nextCursor(columns, { column: 3, segment: 1 }, 'ArrowUp'), {
      column: 3,
      segment: 2,
    })
    assert.deepEqual(nextCursor(columns, { column: 3, segment: 2 }, 'ArrowUp'), {
      column: 3,
      segment: 2,
    })
    assert.deepEqual(nextCursor(columns, { column: 3, segment: 0 }, 'ArrowDown'), {
      column: 3,
      segment: 0,
    })
  })
})
