/**
 * The numbers the period chart draws and says. Each expectation is worked out by hand from the
 * data in the test, not read back from the module: a stack whose segments meet end to end and add
 * up to the period's sum, a scale from zero past the tallest column, and a period's words.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import {
  columnNotes,
  columnSummary,
  columnWidth,
  dayTicks,
  labelledColumns,
  segmentPlace,
  stackColumns,
  valueTicks,
} from '@/shared/ui/chartGeometry.ts'
import { periodHint } from '@/shared/ui/markHints.ts'

import { column, series, words } from './fixtures/periodChart.ts'

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
    // With no words for it the summary stays as it was.
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

describe('a period still running', () => {
  test('is drawn at what it holds so far, says so in its name, and has no word under its column', () => {
    const columns = [column('d1', { a: 4 }), column('d2', { a: 6 }), column('d3', { a: 1 }, true)]
    const { columns: stacked, top } = stackColumns(columns, series)
    // Its amount is not projected forward: the column is as tall as what it holds.
    assert.equal(stacked[2]?.total, 1)
    assert.equal(top, 6)
    const [last] = stacked.slice(-1)
    assert.ok(last)
    assert.equal(columnSummary(last, words, String), 'd3: total 1 so far; Account A 1')
    // The axis names it as any period: its hatching and its hint say it is under way.
    const ticks = dayTicks(columns, 0)
    assert.deepEqual(ticks.at(-1), {
      key: 'd3',
      text: 'd3',
      offset: 2.5 / 3,
      edge: 'middle',
    })
  })

  test('with no sum to say, still says it is running', () => {
    const said = { ...words, absent: 'No price' }
    const { columns } = stackColumns([{ ...column('d1', {}, true), absent: ['a'] }], series)
    const [one] = columns
    assert.ok(one)
    assert.equal(columnSummary(one, said, String), 'd1. so far. No price: Account A')
  })

  test('is named on the axis even where the axis has no room for its neighbours', () => {
    const columns = Array.from({ length: 30 }, (_, index) =>
      column(`d${index}`, { a: 1 }, index === 20),
    )
    const named = new Set(dayTicks(columns, 330).map((tick) => tick.key))
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
      dayTicks(columns, 1000).map((tick) => [tick.edge, tick.offset]),
      [
        ['middle', 0.5 / 4],
        ['middle', 1.5 / 4],
        ['middle', 2.5 / 4],
        ['middle', 3.5 / 4],
      ],
    )
  })

  test('the first name it prints, and the first it prints of each later month, carry the month', () => {
    // 29 October to 4 November, named «Thu 29» … and, with the month, «Oct 29» ….
    const days = [29, 30, 31, 1, 2, 3, 4].map((day, index) => ({
      ...column(`d${index}`, {}),
      label: `D${day}`,
      dated: { label: `${index < 3 ? 'Oct' : 'Nov'} ${day}`, month: index < 3 ? '10' : '11' },
    }))
    const printed = (width: number) => dayTicks(days, width).map((tick) => tick.text)
    assert.deepEqual(printed(1000), ['Oct 29', 'D30', 'D31', 'Nov 1', 'D2', 'D3', 'D4'])
    // Where 1 November is not named, the first name of November carries the month.
    assert.deepEqual(printed(150), ['Oct 31', 'Nov 4'])
    // A period whose name needs no month, an hour, keeps its name.
    assert.deepEqual(
      dayTicks([column('h1', {})], 1000).map((tick) => tick.text),
      ['h1'],
    )
  })

  test('the running hour keeps its name, and a neighbour that would touch it gives way', () => {
    // «Today» at 14:30 over 480px: the axis steps by four hours back from 23:00, which names
    // 15:00 beside the running 14:00, and the two printed as «14:0015:00».
    const hours = Array.from({ length: 24 }, (_, hour) => ({
      ...column(`h${hour}`, {}, hour === 14),
      label: `${String(hour).padStart(2, '0')}:00`,
    }))
    const unmeasured = new Set(dayTicks(hours, 480).map((tick) => tick.key))
    assert.ok(unmeasured.has('h14') && unmeasured.has('h15'))
    const named = dayTicks(hours, 480, sevenWide).map((tick) => tick.key)
    assert.deepEqual(named, ['h3', 'h7', 'h11', 'h14', 'h19', 'h23'])
  })

  test('keeps more than a space between any two names at every width', () => {
    const spans = [7, 24, 30, 60, 90]
    for (const count of spans)
      for (const running of [-1, 0, 1, Math.floor(count / 2), count - 2, count - 1])
        for (let width = 60; width <= 2000; width += 7) {
          const columns = Array.from({ length: count }, (_, index) => ({
            ...column(`p${index}`, {}, index === running),
            label: index % 2 ? `${index} Wed` : `${index}:00`,
            dated: { label: `Nov ${index}`, month: index < count / 2 ? '10' : '11' },
          }))
          const ticks = dayTicks(columns, width, sevenWide)
          const where = `${count} periods, running ${running}, ${width}px`
          if (running >= 0)
            assert.ok(
              ticks.some((tick) => tick.key === `p${running}`),
              where,
            )
          const boxes = ticks.map((tick) => placed(tick, width))
          for (let at = 1; at < boxes.length; at += 1)
            assert.ok((boxes[at]?.start ?? 0) - (boxes[at - 1]?.end ?? 0) >= 8, where)
        }
  })
})

/** A label as wide as seven pixels a character, as a stand-in for the axis's font. */
const sevenWide = (text: string) => text.length * 7

/**
 * Where `ChartTicks` draws a label of the time axis: its middle at its share of the axis, moved
 * in as far as it would hang past either end, as wide as its text.
 */
function placed(tick: { offset: number; text: string }, width: number) {
  const wide = sevenWide(tick.text)
  const start = Math.max(0, Math.min(tick.offset * width - wide / 2, width - wide))
  return { start, end: start + wide }
}

describe('a change at the start of a period', () => {
  test('is said where the period is read: its hint, its name and its row of the table', () => {
    const { columns } = stackColumns(
      [column('d1', { a: 1 }), column('d2', { a: 1 }), column('d3', { a: 1, b: 2 })],
      series,
      [
        { at: 'd3', label: 'Account change: A → A, B' },
        { at: 'd3', label: 'Limit reset' },
      ],
    )
    const [first, , third] = columns
    assert.ok(first && third)
    assert.equal(
      periodHint(third, { words, formatValue: String }).text,
      'd3: total 3\nAccount change: A → A, B\nLimit reset\nAccount B 2\nAccount A 1',
    )
    assert.equal(
      columnSummary(third, words, String),
      'd3: total 3; Account A 1, Account B 2. Account change: A → A, B. Limit reset',
    )
    assert.deepEqual(columnNotes(third, words), ['Account change: A → A, B', 'Limit reset'])
    assert.equal(periodHint(first, { words, formatValue: String }).text, 'd1: total 1\nAccount A 1')
  })
})
