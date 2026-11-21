/**
 * The numbers a ring of shares draws. Each expectation is worked out by hand from the rows in the
 * test, not read back from the module: which parts the ring draws and in what order, what folds
 * into the rest past five sectors or past a colour close to one named before it, each part's
 * share of the whole and its place round the ring, and
 * that a part keeps the hue its page gave its value.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import { bandAt, ringOf, sectorPath, turnAt } from '@/shared/ui/donutGeometry.ts'

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

  test('given a whole larger than its parts, draws each its share of it and leaves the rest open', () => {
    // A part of 10 left out of a whole of 100 by the caller: the others keep their shares of 100.
    const rows = [row('high', 60, { slot: 1 }), row('medium', 30, { slot: 2 })]
    const ring = ringOf(rows, undefined, 100)
    assert.equal(ring.whole, 100)
    assert.deepEqual(
      ring.sectors.map((one) => [
        one.row?.key,
        ...[one.share, one.start, one.end].map((at) => Math.round(at * 1000) / 1000),
      ]),
      [
        ['high', 0.6, 0, 0.6],
        ['medium', 0.3, 0.6, 0.9],
      ],
    )
    // A whole no larger than the parts is their own sum, and the ring closes.
    assert.equal(ringOf(rows, undefined, 50).whole, 90)
    assert.equal(ringOf(rows, undefined, 50).sectors.at(-1)?.end, 1)
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

  test('names four hues and past them folds the smaller parts into one rest', () => {
    // Five parts in the first five hues: the fifth stays close to the second in some pair, so
    // it is the rest, as it would be past five sectors.
    const five = [50, 20, 15, 10, 5].map((value, index) => row(`v${index}`, value))
    assert.deepEqual(
      placed(five).map(({ key, slot }) => [key, slot]),
      [
        ['v0', 1],
        ['v1', 2],
        ['v2', 3],
        ['v3', 4],
        ['rest', 'other'],
      ],
    )
    // Five parts with a neutral among them: no two of their colours are close, so all five
    // are named.
    const neutral = [
      row('a', 50, { slot: 1 }),
      row('none', 20, { kind: 'none', slot: 'apart' }),
      row('b', 15, { slot: 2 }),
      row('c', 10, { slot: 3 }),
      row('d', 5, { slot: 4 }),
    ]
    assert.deepEqual(
      placed(neutral).map((one) => one.key),
      ['a', 'none', 'b', 'c', 'd'],
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

  test('names no part whose colour a reader could take for one named before it', () => {
    // Filtered, the value of the sixth hue is the second largest: the sixth stays close to the
    // first, so it folds, and with it every smaller part, never a larger one before a smaller.
    const filtered = ringOf([
      row('a', 50, { slot: 1 }),
      row('f', 30, { slot: 6 }),
      row('b', 20, { slot: 2 }),
    ])
    assert.deepEqual(
      filtered.sectors.map((one) => [one.key, one.slot, one.members.map((member) => member.key)]),
      [
        ['a', 1, []],
        [' rest', 'other', ['f', 'b']],
      ],
    )
    // Two parts in the one darker neutral would look alike: the smaller is the rest.
    assert.deepEqual(
      placed([
        row('none', 50, { kind: 'none', slot: 'apart' }),
        row('a', 40, { slot: 1 }),
        row('unknown', 10, { kind: 'unknown', slot: 'apart' }),
      ]).map((one) => one.key),
      ['none', 'a', 'rest'],
    )
    // A value the page gives no hue is drawn in the rest's own neutral, never named in it.
    assert.deepEqual(
      placed([row('z', 60, { slot: 'other' }), row('a', 40, { slot: 1 })]).map((one) => one.key),
      ['rest'],
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

/** A point rounded to a tenth of the ring's box units. */
const near = ({ x, y }: { x: number; y: number }) => ({
  x: Math.round(x * 10) / 10,
  y: Math.round(y * 10) / 10,
})

describe("a sector's hint point", () => {
  // The box is 100 units a side, its centre at 50, 50, the middle of the band 40.5 from it.
  test("reads a point of the box as its turn from 12 o'clock clockwise", () => {
    assert.equal(turnAt(50, 10), 0)
    assert.equal(turnAt(90, 50), 0.25)
    assert.equal(turnAt(50, 90), 0.5)
    assert.equal(turnAt(10, 50), 0.75)
  })

  test('stands on the middle of the band where the pointer stands on a large sector', () => {
    // Three quarters round a sector of 95 %: at 9 o'clock, not at its middle near 6 o'clock.
    assert.deepEqual(near(bandAt({ start: 0, end: 0.95 }, 0.75)), { x: 9.5, y: 50 })
    assert.deepEqual(near(bandAt({ start: 0, end: 1 }, 0.25)), { x: 90.5, y: 50 })
  })

  test("is held inside the sector, across 12 o'clock from the nearer end", () => {
    // A pointer on the ground just before 12 o'clock: the sector's start, two half gaps in
    // (asin(0.6 / 40.5) a turn of 0.0047), and not its end at 0.95.
    assert.deepEqual(near(bandAt({ start: 0, end: 0.95 }, 0.99)), { x: 51.2, y: 9.5 })
    // Past the end of a sector from 3 to 6 o'clock it stays two half gaps short of 6 o'clock.
    assert.deepEqual(near(bandAt({ start: 0.25, end: 0.5 }, 0.6)), { x: 51.2, y: 90.5 })
  })

  test('keeps the middle of its band on a sector with no room between its ends', () => {
    // From 0.5 to 0.505 of a turn, narrower than two gaps: the middle, at 0.5025.
    assert.deepEqual(near(bandAt({ start: 0.5, end: 0.505 }, 0.5)), { x: 49.4, y: 90.5 })
  })
})
