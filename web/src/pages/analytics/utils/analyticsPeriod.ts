/**
 * The days a view of the Analytics page names, in the browser's own time: what its period is
 * read as, and the days a custom period first stands at.
 */
import { localDay } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import type { UsageStep } from '@/shared/api/analyticsApi.ts'

const MINUTE = 60_000

/** How many minutes «now» shows: the hour up to the moment of the view, the last one running. */
const LIVE_MINUTES = 60

const dayFrom = (text: string) => {
  const [year, month, date] = text.split('-').map(Number)
  return new Date(year, month - 1, date)
}

const shiftDays = (day: Date, days: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate() + days)

/** What the read is asked for: `from` and `to` as the contract takes them, at this offset. */
export interface PeriodBounds {
  from: string
  to: string
  utcOffset: number
}

/**
 * The period a view names at a moment, in the browser's own time: the last hour as sixty minutes
 * to now, the minute now running the last of them; today whole, from its midnight to the next, so
 * its hours still to come stand empty after the one running; this week from Monday's midnight to
 * now, the past four weeks from the midnight 27 days ago to now, or the custom days whole. Null
 * for a custom period with a day missing or its end before its start.
 */
export function periodBounds(view: AnalyticsView, now: Date): PeriodBounds | null {
  const utcOffset = -now.getTimezoneOffset()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const untilNow = now.toISOString()
  // A whole minute of the clock is one of UTC too: every offset is whole minutes.
  const running = Math.ceil(now.getTime() / MINUTE) * MINUTE
  if (view.period === 'now')
    return {
      from: new Date(running - LIVE_MINUTES * MINUTE).toISOString(),
      to: untilNow,
      utcOffset,
    }
  if (view.period === 'today')
    return { from: localDay(today), to: localDay(shiftDays(today, 1)), utcOffset }
  if (view.period === 'week')
    return {
      from: localDay(shiftDays(today, -((today.getDay() + 6) % 7))),
      to: untilNow,
      utcOffset,
    }
  if (view.period === 'weeks4')
    return { from: localDay(shiftDays(today, -27)), to: untilNow, utcOffset }
  if (!view.from || !view.to || view.to < view.from) return null
  return { from: view.from, to: localDay(shiftDays(dayFrom(view.to), 1)), utcOffset }
}

/**
 * How a view's period is cut into columns: the live hour by its minutes, today and any other
 * single day by its hours, any longer one by days.
 */
export function stepOf(view: AnalyticsView): UsageStep {
  if (view.period === 'now') return 'minute'
  if (view.period === 'today') return 'hour'
  return view.period === 'custom' && Boolean(view.from) && view.from === view.to ? 'hour' : 'day'
}

/** A custom period's start and end, as they first stand when it is chosen: this week's days. */
export function customDays(now: Date): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return { from: localDay(shiftDays(today, -((today.getDay() + 6) % 7))), to: localDay(today) }
}
