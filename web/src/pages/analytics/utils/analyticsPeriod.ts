/**
 * The days a view of the Analytics page names, in the browser's own time: what its period is
 * read as, and the days a custom period first stands at.
 */
import { localDay } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'

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
 * The period a view names at a moment, in the browser's own time: this week from Monday's
 * midnight to now, the past four weeks from the midnight 27 days ago to now, or the custom days
 * whole. Null for a custom period with a day missing or its end before its start.
 */
export function periodBounds(view: AnalyticsView, now: Date): PeriodBounds | null {
  const utcOffset = -now.getTimezoneOffset()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const untilNow = now.toISOString()
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

/** A custom period's start and end, as they first stand when it is chosen: this week's days. */
export function customDays(now: Date): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return { from: localDay(shiftDays(today, -((today.getDay() + 6) % 7))), to: localDay(today) }
}
