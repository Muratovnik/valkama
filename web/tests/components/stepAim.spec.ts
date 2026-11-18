/**
 * Where the pointer finds a place of a step line (`aimAt`), held to the rule `StepLine` states:
 * a mark within the pointer's reach wins, the nearest of several, the earlier where two are as
 * near; elsewhere the place whose stretch holds the pointer, held inside the field; none where no
 * place does. The oracle is that rule, worked out by hand.
 */
import { describe, expect, it } from 'vitest'

import { aimAt } from '@/shared/ui/windowGeometry.ts'

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
