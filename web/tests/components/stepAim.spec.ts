/**
 * Where the pointer finds a place of a step line (`aimAt`), held to the rule `StepLine` states:
 * a mark within the pointer's reach wins, the nearest of several, the earlier where two are as
 * near; elsewhere the place whose stretch holds the pointer, held inside the field; none where no
 * place does. The oracle is that rule, worked out by hand.
 */
import { describe, expect, it } from 'vitest'

import { aimAt, restartFall, stepStops } from '@/shared/ui/windowGeometry.ts'
import type { StepPoint } from '@/shared/ui/windowGeometry.ts'

/** How near a mark the pointer finds it: half a mark as drawn when pointed at. */
const HIT = 6

/**
 * Where the pointer finds a place of a step line (`aimAt`), on a frame of 300 ms drawn 300 px wide,
 * so a moment and a pixel are one number: readings at 100 and 112, the second's step to now at
 * 200, «now» there, and the corridor from now to the forecast's ring at 300. A mark within six
 * pixels wins, the nearest; elsewhere the place whose stretch holds the pointer.
 */
describe('where the pointer finds a place of a step line', () => {
  const frame = { from: 0, to: 300, top: 100 }
  const aims = [
    { at: 100, from: 100, to: 112 },
    { at: 112, from: 112, to: 200 },
    { at: 200, from: 200, to: 200 },
    { at: 300, from: 200, to: 300 },
  ]
  const at = (x: number) => aimAt(frame, aims, x, { width: 300, radius: HIT })

  it('finds each place at its mark, the first and the last and the ring on the edge', () => {
    expect([100, 112, 200, 300].map((x) => at(x))).toEqual([0, 1, 2, 3])
  })

  it('finds the nearer of two readings closer than a pointer is wide, the earlier where alike', () => {
    // Twelve pixels apart: a reach 24 px wide from the first once covered the second's mark.
    expect([103, 105, 109, 111].map((x) => at(x))).toEqual([0, 0, 1, 1])
    expect(at(106)).toBe(0)
  })

  it('finds a place along its stretch where no mark is near, and none where nothing stands', () => {
    // The second reading's step, the corridor, and nothing before the first reading.
    expect([150, 250, 50].map((x) => at(x))).toEqual([1, 3, null])
  })

  it('finds the ring on the edge half a mark past the field, and nothing beyond its reach', () => {
    expect(at(300 + HIT)).toBe(3)
    // Past the reach of every mark, a point outside the field is held at its edge.
    expect(aimAt(frame, aims.slice(0, 2), 300 + HIT, { width: 300, radius: HIT })).toBeNull()
    expect(aimAt(frame, aims.slice(0, 3), 300 + HIT, { width: 300, radius: HIT })).toBeNull()
  })
})

/** A reading of a step line at `at` with `value`, its words left out. */
const reading = (at: number, value: number): StepPoint => ({
  at,
  value,
  key: `${at}`,
  noteText: '',
  text: '',
  timeText: '',
  valueText: '',
})

/**
 * Where a restart of a window's count stands among a step line's places, held to the rule
 * `StepLine` and `windowGeometry` state: a restart is a place at the moment of the reading it
 * restarted at, walked before that reading, found by the pointer at its moment before it, and its
 * ring spans the fall the line draws there, from the share the line held before to the share at
 * it. The oracle is that rule on readings of 99 % at 100 and 0 % at 112, worked out by hand.
 */
describe('a restart of a window’s count on its step line', () => {
  it('stands before the reading at its moment, among the readings in the order they stand', () => {
    const readings = [reading(100, 99), reading(112, 0), reading(200, 10)]
    expect(stepStops(readings, [{ at: 112 }])).toEqual([
      { kind: 'reading', index: 0 },
      { kind: 'restart', index: 0 },
      { kind: 'reading', index: 1 },
      { kind: 'reading', index: 2 },
    ])
    // With no restart the readings are the walk alone, in their order.
    expect(stepStops(readings, [])).toEqual(
      readings.map((_, index) => ({ kind: 'reading', index })),
    )
  })

  it('is found by the pointer at its moment, and the reading it restarted at along its step', () => {
    const frame = { from: 0, to: 300, top: 100 }
    const aims = [
      { at: 100, from: 100, to: 112 },
      { at: 112, from: 112, to: 112 },
      { at: 112, from: 112, to: 200 },
    ]
    const at = (x: number) => aimAt(frame, aims, x, { width: 300, radius: HIT })
    expect([112, 112 - HIT + 1, 112 + HIT - 1].map((x) => at(x))).toEqual([1, 1, 1])
    expect([112 + HIT + 1, 150].map((x) => at(x))).toEqual([2, 2])
  })

  it('marks the fall the line draws at its moment, from the share held before it', () => {
    expect(restartFall([reading(100, 99), reading(112, 0)], 112)).toEqual({ high: 99, low: 0 })
    // Another feed's lower reading before the restart is where the line stood when it fell.
    expect(restartFall([reading(100, 99), reading(105, 30), reading(112, 0)], 112)).toEqual({
      high: 30,
      low: 0,
    })
    // Where no reading stood before it, the ring stands at its own reading.
    expect(restartFall([reading(112, 4), reading(200, 10)], 112)).toEqual({ high: 4, low: 4 })
  })
})
