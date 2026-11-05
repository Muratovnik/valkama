/**
 * What a comet does on a line of any length: the dash it draws, how far that dash travels
 * and how long that takes. The browser's half, on real lines, is `production-graph-comet`.
 */
import { describe, expect, it } from 'vitest'

import { cometRun } from '@/widgets/work-item-graph/utils/graphComet.ts'

/** The dashes a pass begins with, as stretches of a line of this length. */
function dashesAt(length: number, offset: number, dash: number, gap: number) {
  const seen: [number, number][] = []
  for (let start = -offset - (dash + gap); start < length; start += dash + gap) {
    const [from, to] = [Math.max(start, 0), Math.min(start + dash, length)]
    if (to > from) seen.push([from, to])
  }
  return seen
}

describe('cometRun', () => {
  it.each([0, 10, 32, 64, 500, 1248, 1249, 1280, 6000])(
    'keeps one length and one speed on a line of %i',
    (length) => {
      const run = cometRun(length)
      expect(run.dash).toBe(32)
      expect((run.dash + run.gap) / run.seconds).toBeCloseTo(160, 6)
    },
  )

  it.each([0, 10, 32, 64, 500, 1248])(
    'takes one comet across a line of %i and back unseen',
    (length) => {
      const { dash, gap, from, to } = cometRun(length)
      expect(from - to).toBe(dash + gap)
      expect(dashesAt(length, from, dash, gap)).toEqual([])
      expect(dashesAt(length, to, dash, gap)).toEqual([])
    },
  )

  it('crosses a line shorter than itself without breaking', () => {
    const { dash, gap, from, to } = cometRun(10)
    const midway = (from + to) / 2
    expect(gap).toBe(10)
    expect(dashesAt(10, midway, dash, gap)).toEqual([[0, 10]])
  })

  it('sends the next comet along a long line at the same speed instead of hurrying this one', () => {
    const { dash, gap, from, to, seconds } = cometRun(6000)
    expect(seconds).toBe(8)
    // The same picture at both ends of the pass, so beginning again jumps nowhere.
    expect(dashesAt(6000, from, dash, gap)).toEqual(dashesAt(6000, to, dash, gap))
    expect(dashesAt(6000, from, dash, gap).length).toBeGreaterThan(3)
  })
})
