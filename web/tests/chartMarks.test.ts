/**
 * What a mark of the period chart says and does: its hint, the element it is drawn as, and where
 * the keyboard goes from it. Each expectation is worked out by hand from the data in the test.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import type { PeriodSeries, RankedRow } from '@/shared/ui/chartGeometry.ts'
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
import { ringOf } from '@/shared/ui/donutGeometry.ts'
import {
  multiplePeriodHint,
  namedHint,
  periodHint,
  readingHint,
  ringHint,
  seriesHint,
} from '@/shared/ui/markHints.ts'

import { column, series, words } from './fixtures/periodChart.ts'

const percent = (ratio: number) => `${Math.round(ratio * 100)}% of the total`
const bare = (ratio: number) => `${Math.round(ratio * 100)}%`
const every = () => true
/** A ranked row named by its key, its figure written as it is. */
const ranked = (key: string, value: number): RankedRow => ({
  key,
  label: key,
  value,
  valueText: `${value}`,
})
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
      periodHint(one, { words: said, formatValue: String }).text,
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
    assert.equal(periodHint(one, { words, formatValue: String }).text, 'd1: total 0')
  })

  // A segment has no hint of its own: its period's says what the segment's did, its share too.
  test('of a period, where its chart says how a share reads: each series with its share of it', () => {
    const { columns } = stackColumns([column('d1', { a: 1, b: 3 }, true)], series)
    const [one] = columns
    assert.ok(one)
    assert.equal(
      periodHint(one, { words, formatValue: String, formatShare: percent }).text,
      'd1: total 4 so far\nAccount B 3, 75% of the total\nAccount A 1, 25% of the total',
    )
    // With no words for a share, none is said.
    assert.equal(
      periodHint(one, { words, formatValue: String }).text,
      'd1: total 4 so far\nAccount B 3\nAccount A 1',
    )
    // A segment's name says its share as well, between its figure and its period's sum.
    const [first] = one.segments
    assert.ok(first)
    assert.equal(
      segmentSummary(one, first, { words, formatValue: String, formatShare: percent }),
      'd1: Account A 1, 25% of the total, total 4 so far',
    )
  })

  // The hint once ran every fact of a period together as lines of words that wrapped mid-phrase.
  test('of a period, as a grid: its name and sum, the period before, its series with hue and bare share, its notes', () => {
    const said = { ...words, before: 'period before' }
    const { columns } = stackColumns(
      [{ ...column('d1', { a: 1, b: 4, c: 2 }, true), before: 9 }],
      series,
      [{ at: 'd1', label: 'Switched to B' }],
    )
    const [one] = columns
    assert.ok(one)
    const hint = periodHint(one, { words: said, formatValue: String, formatPart: bare })
    assert.deepEqual(hint.body, {
      head: { name: 'd1', figure: '7 so far' },
      quiet: [{ name: 'period before', figure: '9' }],
      // Largest first: 4 of 7, 2 of 7, 1 of 7.
      rows: [
        { key: 'b', slot: 2, name: 'Account B', figure: '4', share: '57%' },
        { key: 'c', slot: 3, name: 'Account C', figure: '2', share: '29%' },
        { key: 'a', slot: 1, name: 'Account A', figure: '1', share: '14%' },
      ],
      notes: ['Switched to B'],
    })
    // The words are what they were: the bare share is the grid's alone.
    assert.equal(
      hint.text,
      'd1: total 7 so far, period before 9\nSwitched to B\nAccount B 4\nAccount C 2\nAccount A 1',
    )
    // With no bare share, the rows have none, though the words say theirs.
    const worded = periodHint(one, { words: said, formatValue: String, formatShare: percent })
    assert.deepEqual(
      worded.body.rows.map((row) => row.share),
      [undefined, undefined, undefined],
    )
    assert.match(worded.text, /Account B 4, 57% of the total/u)
  })

  test('of a period with no sum to say, as a grid: its name alone, and why under it', () => {
    const said = { ...words, absent: 'No price', pending: 'No data yet' }
    const { columns } = stackColumns(
      [
        { ...column('d1', {}), absent: ['a'] },
        { ...column('d2', {}), pending: true },
      ],
      series,
    )
    const [absent, pending] = columns
    assert.ok(absent && pending)
    assert.deepEqual(periodHint(absent, { words: said, formatValue: String }).body, {
      head: { name: 'd1' },
      quiet: [],
      rows: [],
      notes: ['No price: Account A'],
    })
    assert.deepEqual(periodHint(pending, { words: said, formatValue: String }).body, {
      head: { name: 'd2' },
      quiet: [],
      rows: [],
      notes: ['No data yet'],
    })
  })

  test('of a legend entry: its series over every period, and its share of them all', () => {
    const { columns } = stackColumns([column('d1', { a: 1, b: 3 }), column('d2', { a: 4 })], series)
    const [a, , c] = series
    assert.ok(a && c)
    // Its series' swatch and name head the grid, with the figure; the share under them.
    assert.deepEqual(seriesHint(a, columns, String, percent), {
      text: '5, 63% of the total',
      body: {
        head: { name: 'Account A', figure: '5', slot: 1 },
        rows: [],
        notes: ['63% of the total'],
      },
    })
    assert.deepEqual(seriesHint(c, columns, String, percent), {
      text: '0, 0% of the total',
      body: {
        head: { name: 'Account C', figure: '0', slot: 3 },
        rows: [],
        notes: ['0% of the total'],
      },
    })
  })

  test('of a mark that prints its name and figure: what the name leaves out and its share', () => {
    const row = { label: 'acc-1f2e', value: 30, detail: 'acc-1f2e-77aa', slot: 2 as const }
    assert.deepEqual(namedHint(row, 120, percent), {
      text: 'acc-1f2e-77aa\n25% of the total',
      words: 'acc-1f2e',
      body: {
        head: { name: 'acc-1f2e', slot: 2 },
        rows: [],
        notes: ['acc-1f2e-77aa', '25% of the total'],
      },
    })
    // Nothing to add: the hint is the name, shown while the name is cut, and the host draws no
    // grid for an empty text (`vTooltip`).
    assert.deepEqual(namedHint({ label: 'opus', value: 3 }, 0, percent), {
      text: '',
      words: 'opus',
      body: { head: { name: 'opus' }, rows: [], notes: [] },
    })
    assert.equal(shareWords(1, 0, percent), '')
    assert.equal(shareWords(-1, 4, percent), '0% of the total')
  })

  test('of a small chart’s period: the chart beside its hue with the figure, then the period', () => {
    assert.deepEqual(multiplePeriodHint({ label: 'Task A', slot: 4 }, 'Tue 10 Nov', '2 h'), {
      text: 'Task A\nTue 10 Nov: 2 h',
      body: { head: { name: 'Task A', figure: '2 h', slot: 4 }, rows: [], notes: ['Tue 10 Nov'] },
    })
  })

  test('of a reading: its moment and value beside its line’s hue, and where it was read', () => {
    const point = {
      at: 0,
      key: 'r1',
      noteText: 'the poll',
      text: '12:05, 35%, the poll',
      timeText: '12:05',
      value: 0.35,
      valueText: '35%',
    }
    assert.deepEqual(readingHint(point, 1), {
      text: '12:05, 35%, the poll',
      body: { head: { name: '12:05', figure: '35%', slot: 1 }, rows: [], notes: ['the poll'] },
    })
  })

  test('of a ring’s rest: five of its parts largest first, and one line for the others', () => {
    // Four named parts, then eight that fold into the rest: 7, 6, 5, 4, 3 by name, and 2 + 1 + 1
    // as one line of three more. The whole is 98.
    const ring = ringOf(
      [
        ranked('w', 30),
        ranked('x', 20),
        ranked('y', 10),
        ranked('z', 9),
        ...[7, 6, 5, 4, 3, 2, 1, 1].map((value, at) => ranked(`p${at}`, value)),
      ],
      5,
    )
    const rest = ring.sectors.at(-1)
    assert.ok(rest && rest.members.length === 8)
    const chart = {
      formatValue: String,
      formatPart: bare,
      formatShare: percent,
      rest: (count: number) => `Other, ${count} more`,
    }
    const hint = ringHint(rest, ring.whole, chart)
    assert.ok(typeof hint === 'object' && hint?.body)
    assert.deepEqual(hint.body.head, { name: 'Other, 8 more', figure: '29', slot: 'other' })
    assert.deepEqual(
      hint.body.rows.map((one) => [one.name, one.figure, one.share]),
      [
        ['p0', '7', '7%'],
        ['p1', '6', '6%'],
        ['p2', '5', '5%'],
        ['p3', '4', '4%'],
        ['p4', '3', '3%'],
        ['Other, 3 more', '4', '4%'],
      ],
    )
    assert.deepEqual(hint.body.notes, ['30% of the total'])
    assert.equal(
      hint.text,
      '29, 30% of the total\np0: 7\np1: 6\np2: 5\np3: 4\np4: 3\nOther, 3 more: 4',
    )
    // A part's own sector: its name beside its hue, its figure, its share.
    const first = ring.sectors[0]
    assert.ok(first)
    const own = ringHint(first, ring.whole, chart)
    assert.ok(typeof own === 'object' && own?.body)
    assert.deepEqual(own.body, {
      head: { name: 'w', figure: '30', slot: first.slot },
      rows: [],
      notes: ['31% of the total'],
    })
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
