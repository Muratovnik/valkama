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
import { ringOf, sectorPath } from '@/shared/ui/donutGeometry.ts'

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
