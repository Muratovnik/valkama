/**
 * The reader's own period a press or a frame on a chart of periods sets. The oracle is the
 * requirement: a period pressed is that period alone, and a frame the periods it covers from the
 * first one's start to the last one's end; whole days stay days, as a day pressed always was,
 * and hours and minutes are the moments they run between, the minute still running included.
 */
import { describe, expect, it } from 'vitest'

import { stepOf, stepsSpan } from '@/pages/analytics/utils/analyticsPeriod.ts'

import { DEFAULT_VIEW } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'

import { serveUsage } from './fixtures/analytics.ts'

/** A moment of the query: a day as it is written, an instant in UTC. */
const asked = (moment: Date | string) =>
  typeof moment === 'string' ? moment : moment.toISOString()

/** The answer a read of `from` to `to` by `step` gives, its moments at the browser's offset. */
function answer(from: Date | string, to: Date | string, step: string) {
  const offset = String(-new Date(2026, 10, 11).getTimezoneOffset())
  const query = new URLSearchParams({ from: asked(from), to: asked(to), step, utc_offset: offset })
  return serveUsage([], query).usage
}

/** «Today» by the hour. */
const today = () => answer('2026-11-11', '2026-11-12', 'hour')

describe('the period of the steps pressed or framed', () => {
  it('gives an hour of «Today» pressed its own moments, an hour long', () => {
    expect(today().series).toHaveLength(24)
    expect(stepsSpan(today(), 10, 10)).toEqual({
      period: 'custom',
      from: '2026-11-11T10:00',
      to: '2026-11-11T11:00',
    })
  })

  it('gives three hours framed, in either direction, from the first one’s start to the last one’s end', () => {
    const span = { period: 'custom', from: '2026-11-11T10:00', to: '2026-11-11T13:00' }
    expect(stepsSpan(today(), 10, 12)).toEqual(span)
    expect(stepsSpan(today(), 12, 10)).toEqual(span)
    // Which the address reads back as its own span, by the hour.
    expect(stepOf({ ...DEFAULT_VIEW, ...span } as AnalyticsView)).toBe('hour')
  })

  it('keeps the minute still running in a frame that ends on it', () => {
    // «Now» at 14:30:20: its last minute runs from 14:30 to the moment read.
    const now = answer(new Date(2026, 10, 11, 13, 31), new Date(2026, 10, 11, 14, 30, 20), 'minute')
    const last = now.series.length - 1
    expect(stepsSpan(now, last - 2, last)).toEqual({
      period: 'custom',
      from: '2026-11-11T14:28',
      to: '2026-11-11T14:31',
    })
  })

  it('gives whole days framed their days, the last one included, as a day pressed has', () => {
    const week = answer('2026-11-09', '2026-11-16', 'day')
    expect(stepsSpan(week, 1, 3)).toEqual({
      period: 'custom',
      from: '2026-11-10',
      to: '2026-11-12',
    })
    expect(stepsSpan(week, 2, 2)).toEqual({
      period: 'custom',
      from: '2026-11-11',
      to: '2026-11-11',
    })
  })

  it('gives days of a span that starts inside one the moments they run between', () => {
    const days = answer(new Date(2026, 10, 8, 10), new Date(2026, 10, 12, 10), 'day')
    expect(stepsSpan(days, 0, 0)).toEqual({
      period: 'custom',
      from: '2026-11-08T10:00',
      to: '2026-11-09T00:00',
    })
  })

  it('gives nothing for a step the answer does not have', () => {
    expect(stepsSpan(today(), 30, 31)).toBeNull()
  })
})
