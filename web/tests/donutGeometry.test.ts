/**
 * The numbers a ring of shares draws. Each expectation is worked out by hand from the rows in the
 * test, not read back from the module: which parts the ring draws and in what order, what folds
 * into the rest past five sectors, each part's share of the whole and its place round the ring,
 * that a part keeps the hue its page gave its value, and when a share fits on its sector in words.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import { labelFits, ringOf, sectorPath } from '@/shared/ui/donutGeometry.ts'

const row = (key: string, value: number, more: Partial<RankedRow> = {}): RankedRow => ({
  key,
  label: key,
  value,
  valueText: `${value}`,
  ...more,
})

/** A sector's key, slot, share and place round the ring, its share rounded to a thousandth. */
const placed = (rows: readonly RankedRow[]) =>
  ringOf(rows).sectors.map((one) => ({
    key: one.row?.key ?? 'rest',
    slot: one.slot,
    share: Math.round(one.share * 1000) / 1000,
    start: Math.round(one.start * 1000) / 1000,
    end: Math.round(one.end * 1000) / 1000,
  }))

describe('the ring', () => {
  test('draws its parts largest first from the top, each its share of the whole', () => {
    const rows = [
      row('low', 20, { slot: 3 }),
      row('high', 50, { slot: 1 }),
      row('medium', 30, { slot: 2 }),
    ]
    assert.equal(ringOf(rows).whole, 100)
    assert.deepEqual(placed(rows), [
      { key: 'high', slot: 1, share: 0.5, start: 0, end: 0.5 },
      { key: 'medium', slot: 2, share: 0.3, start: 0.5, end: 0.8 },
      { key: 'low', slot: 3, share: 0.2, start: 0.8, end: 1 },
    ])
  })

  test('keeps the hue the page gave a value, whatever its rank in the ring', () => {
    // Filtered, the value the page ranks fourth is the largest here: it stays in the fourth hue.
    assert.deepEqual(
      placed([row('cloud', 9, { slot: 4 }), row('local', 1, { slot: 1 })]).map((one) => one.slot),
      [4, 1],
    )
    // With no hue given, a part takes its rank's.
    assert.deepEqual(
      placed([row('a', 3), row('b', 2), row('c', 1)]).map((one) => one.slot),
      [1, 2, 3],
    )
  })

  test('draws five parts as they are, and past five folds the smaller into one rest', () => {
    const five = [50, 20, 15, 10, 5].map((value, index) => row(`v${index}`, value))
    assert.deepEqual(
      placed(five).map((one) => one.key),
      ['v0', 'v1', 'v2', 'v3', 'v4'],
    )

    const slots: SeriesSlot[] = [1, 2, 3, 4, 5, 6, 'other']
    const seven = [40, 20, 15, 10, 6, 5, 4].map((value, index) =>
      row(`v${index}`, value, { slot: slots[index] }),
    )
    const ring = ringOf(seven)
    // Four named parts and the rest of the three smallest, 6 + 5 + 4 = 15 of 100.
    assert.deepEqual(
      placed(seven).map(({ key, slot, share }) => ({ key, slot, share })),
      [
        { key: 'v0', slot: 1, share: 0.4 },
        { key: 'v1', slot: 2, share: 0.2 },
        { key: 'v2', slot: 3, share: 0.15 },
        { key: 'v3', slot: 4, share: 0.1 },
        { key: 'rest', slot: 'other', share: 0.15 },
      ],
    )
    const rest = ring.sectors.at(-1)
    assert.equal(rest?.value, 15)
    assert.deepEqual(
      rest?.members.map((one) => one.key),
      ['v4', 'v5', 'v6'],
    )
  })

  test('ranks work with no value among the parts and lists the rows apart outside the whole', () => {
    const ring = ringOf([
      row('input', 60, { slot: 1 }),
      row('none', 30, { kind: 'none', slot: 'apart' }),
      row('output', 10, { slot: 4 }),
      row('cached_read', 900, { kind: 'other' }),
    ])
    // The cache reads, ten times the rest, set no share: the whole is the three parts' 100.
    assert.equal(ring.whole, 100)
    assert.deepEqual(
      ring.sectors.map((one) => [one.key, one.slot, one.share]),
      [
        ['input', 1, 0.6],
        ['none', 'apart', 0.3],
        ['output', 4, 0.1],
      ],
    )
    assert.deepEqual(
      ring.notes.map((one) => one.key),
      ['cached_read'],
    )
  })

  test('leaves out a part of nothing, or of no figure, and draws nothing when no part is left', () => {
    assert.deepEqual(
      placed([row('a', 4), row('zero', 0), row('broken', Number.NaN), row('below', -2)]).map(
        (one) => [one.key, one.share],
      ),
      [['a', 1]],
    )
    const empty = ringOf([row('zero', 0)])
    assert.deepEqual(empty.sectors, [])
    assert.equal(empty.whole, 0)
    assert.deepEqual(ringOf([]).sectors, [])
  })

  test('draws one part as the whole ring, with no edge and no gap', () => {
    const [only] = ringOf([row('local', 7)]).sectors
    assert.equal(only?.share, 1)
    assert.equal(only?.start, 0)
    assert.equal(only?.end, 1)
    const outline = sectorPath(0, 1)
    // Two circles, the outer and the inner, and no straight edge between sectors.
    assert.equal(outline.match(/A 50 50/g)?.length, 2)
    assert.equal(outline.match(/A 31 31/g)?.length, 2)
    assert.equal(outline.includes('L'), false)
  })

  test('outlines a quarter from the top round to the right, and nothing for a part thinner than its gap', () => {
    const quarter = sectorPath(0, 0.25)
    // It starts just right of 12 o'clock on the outer edge and ends just above 3 o'clock.
    const [start] =
      quarter
        .match(/^M ([\d.]+) ([\d.]+)/)
        ?.slice(1)
        .map(Number) ?? []
    assert.ok(start !== undefined && start > 50 && start < 51.5)
    assert.match(quarter, / L /)
    assert.equal(sectorPath(0.5, 0.5001), '')
  })
})

describe('a share on its sector', () => {
  // A ring of 176 pixels: a band of 33 pixels, its middle 71 pixels from the centre.
  const size = 176

  test('fits on a sector whose chord through its band is wider than the words', () => {
    // A quarter: a chord of about 100 pixels, room for «42 %» of 28 by 16.
    assert.equal(labelFits({ start: 0, end: 0.25 }, size, 28, 16), true)
  })

  test('does not fit on a thin sector, a band too narrow, or a ring not laid out yet', () => {
    // A twentieth: a chord of about 22 pixels, short of 28 and the air at both ends.
    assert.equal(labelFits({ start: 0, end: 0.05 }, size, 28, 16), false)
    // A ring of 60 pixels has a band of 11, short of a line of 16.
    assert.equal(labelFits({ start: 0, end: 0.5 }, 60, 28, 16), false)
    assert.equal(labelFits({ start: 0, end: 0.5 }, 0, 28, 16), false)
    assert.equal(labelFits({ start: 0, end: 0.5 }, size, 0, 16), false)
  })
})
