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
  columnNotes,
  columnSummary,
  columnWidth,
  dayTicks,
  foldChanges,
  labelledColumns,
  nextCursor,
  rankRows,
  readoutLines,
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
    const none = stackColumns([], series)
    assert.deepEqual(none, { columns: [], steps: [{ value: 0, text: '0' }], ticks: [0], top: 1 })
    const empty = stackColumns([column('d1', {})], series)
    assert.deepEqual(empty.ticks, [0])
    assert.equal(empty.top, 1)
  })

  test('the period compared with stands on the same scale and is said beside the sum', () => {
    const { columns, top } = stackColumns(
      [
        { ...column('d1', { a: 2 }), before: 7 },
        { ...column('d2', {}), before: 3 },
        { ...column('d3', { a: 1 }), before: null },
      ],
      series,
    )
    // The tallest outline, 7, is past the tallest column, 2: the scale reaches past it.
    assert.equal(top, 8)
    const said = { ...words, before: 'period before' }
    const [first, second, third] = columns
    assert.ok(first && second && third)
    assert.equal(columnSummary(first, said, String), 'd1: total 2, period before 7; Account A 2')
    // Nothing spent and nothing absent is a real zero, said beside what the period before held.
    assert.equal(columnSummary(second, said, String), 'd2: total 0, period before 3')
    assert.equal(columnSummary(third, said, String), 'd3: total 1; Account A 1')
    // With no words for it the readout stays as it was.
    assert.equal(columnSummary(first, words, String), 'd1: total 2; Account A 2')
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

describe('the width of a column', () => {
  test('grows to 56px where a few periods have room, and stays 24px where many or narrow', () => {
    // A week of four days across an 850px plot: broad columns, not thin lines.
    assert.equal(columnWidth(4, 850), 56)
    // Four weeks of days in 560px, and the sixty minutes of an hour: as before.
    assert.equal(columnWidth(28, 560), 24)
    assert.equal(columnWidth(60, 850), 24)
    // Between the two, half a period's room; unmeasured, as before.
    assert.equal(columnWidth(10, 800), 40)
    assert.equal(columnWidth(4, 0), 24)
  })
})

describe('the readout over the chart', () => {
  test('says the period and what is said of it, then the series largest first', () => {
    const said = { ...words, before: 'period before' }
    const { columns } = stackColumns(
      [{ ...column('d1', { a: 1, b: 4, c: 2 }, true), before: 9 }],
      series,
      [{ at: 'd1', label: 'Switched to B' }],
    )
    const [one] = columns
    assert.ok(one)
    assert.deepEqual(readoutLines(one, said, String), {
      head: 'd1: total 7, period before 9. so far. Switched to B',
      series: 'Account B 4, Account C 2, Account A 1',
    })
    // The whole text keeps the stack's order: it is the period's name for assistive technology.
    assert.equal(
      columnSummary(one, said, String),
      'd1: total 7, period before 9; Account A 1, Account B 4, Account C 2. so far. Switched to B',
    )
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
      offset: 2.5 / 3,
      edge: 'middle',
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

describe('a period with no data yet', () => {
  test('says so instead of a sum and never reads as a zero, nor as running «so far»', () => {
    const said = { ...words, pending: 'no data yet' }
    const { columns } = stackColumns(
      [
        column('m1', { a: 2 }),
        { ...column('m2', {}), pending: true },
        { ...column('m3', {}, true), pending: true },
      ],
      series,
    )
    const [first, second, third] = columns
    assert.ok(first && second && third)
    assert.equal(columnSummary(first, said, String), 'm1: total 2; Account A 2')
    assert.equal(columnSummary(second, said, String), 'm2. no data yet')
    // A running period with no data yet holds nothing so far: one clean sentence, no fragment.
    assert.equal(columnSummary(third, said, String), 'm3. no data yet')
    assert.deepEqual(columnNotes(second, said), ['no data yet'])
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

  test('every label stands by its middle under the middle of its column, the first and the last too', () => {
    // Pinning the first and the last to the axis's ends put «Mon, 9» 48px off its column at
    // 1440px; the axis now only moves a label in where it would hang past an end (`ChartTicks`).
    const columns = Array.from({ length: 4 }, (_, index) => column(`d${index}`, {}))
    assert.deepEqual(
      dayTicks(columns, 1000, '').map((tick) => [tick.edge, tick.offset]),
      [
        ['middle', 0.5 / 4],
        ['middle', 1.5 / 4],
        ['middle', 2.5 / 4],
        ['middle', 3.5 / 4],
      ],
    )
  })
})

/** The changes of fourteen days whose first `count` after the first start with a change. */
const changed = (count: number) => {
  const columns = Array.from({ length: 14 }, (_, index) => column(`d${index}`, { a: 1 }))
  const marks = Array.from({ length: count }, (_, index) => ({
    at: `d${index + 1}`,
    label: `to ${index}`,
  }))
  return changeNotes(stackColumns(columns, series, marks).columns)
}

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

  test('fold into one line that counts them from three on, the marks keeping no number', () => {
    const said = { ...words, changes: (count: number) => `Changes: ${count}` }
    for (const count of [0, 2]) {
      assert.equal(foldChanges(changed(count), said), null)
      assert.ok(changeMarkers(changed(count), 14).every((marker) => marker.text !== ''))
    }
    assert.deepEqual(foldChanges(changed(3), said), {
      text: 'Changes: 3',
      whole: 'd1: to 0; d2: to 1; d3: to 2',
    })
    const twelve = foldChanges(changed(12), said)
    assert.equal(twelve?.text, 'Changes: 12')
    assert.equal(twelve?.whole.split('; ').length, 12)
    assert.ok(twelve?.whole.endsWith('d12: to 11'))
    const marks = changeMarkers(changed(12), 14, false)
    assert.equal(marks.length, 12)
    assert.ok(marks.every((marker) => marker.text === ''))
    // A chart with no words for the count keeps a line for each change.
    assert.equal(foldChanges(changed(12), words), null)
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
