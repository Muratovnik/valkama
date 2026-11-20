/**
 * The days and moments a view of the Analytics page names, in the browser's own time: what its
 * period is read as, how it is cut into steps, and the days a custom period first stands at.
 */
import { dayOf, lastDayBefore, named } from '@/pages/analytics/utils/readMoments.ts'

import { isMomentSpan, localDay, momentSpan } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageStep } from '@/shared/api/analyticsApi.ts'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** How many minutes «now» shows: the hour up to the moment of the view, the last one running. */
const LIVE_MINUTES = 60

/**
 * The longest span between moments read by the minute: two hours, so a frame inside «Now» keeps
 * its minutes, and at most 120 columns, twice the live hour's. A span just past it is read by
 * the hour in three columns, where by the minute it would be over 120 thin ones.
 */
const MINUTE_SPAN = 2 * HOUR

/**
 * The longest span between moments read by the hour: three days, at most 72 columns, three times
 * «Today»'s 24. A span just past it is read by the day in four columns, where by the hour it
 * would be over 72.
 */
const HOUR_SPAN = 3 * DAY

const dayFrom = (text: string) => {
  const [year, month, date] = text.split('-').map(Number)
  return new Date(year, month - 1, date)
}

/** A local moment as a custom period holds it, `2030-03-04T10:00`, at the browser's clock. */
const momentFrom = (text: string) => {
  const [day = '', time = ''] = text.split('T')
  const [hour, minute] = time.split(':').map(Number)
  const date = dayFrom(day)
  date.setHours(hour, minute)
  return date
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
 * now, the past four weeks from the midnight 27 days ago to now, the custom days whole, or a
 * custom span from its first moment to its last, at the offset its start had, so its steps are
 * named by the clock it was drawn on. Null for a custom period with an end missing or its end
 * before its start.
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
  if (isMomentSpan(view)) {
    const [from, to] = [momentFrom(view.from), momentFrom(view.to)]
    if (to <= from) return null
    return {
      from: from.toISOString(),
      to: to.toISOString(),
      utcOffset: -from.getTimezoneOffset(),
    }
  }
  return { from: view.from, to: localDay(shiftDays(dayFrom(view.to), 1)), utcOffset }
}

/**
 * Where a view's period starts at a moment, as a time with its offset, as the quota's read takes
 * it: a day's midnight at the browser's clock, or the span's first moment. Null where the view
 * names no period (`periodBounds`).
 */
export function periodStart(view: AnalyticsView, now: Date): string | null {
  const bounds = periodBounds(view, now)
  if (!bounds) return null
  const day = /^\d{4}-\d{2}-\d{2}$/u.test(bounds.from)
  return (day ? dayFrom(bounds.from) : new Date(bounds.from)).toISOString()
}

/**
 * How a view's period is cut into columns: the live hour by its minutes, today and any other
 * single day by its hours, any longer one by days; a span between moments by its length, by the
 * minute up to two hours, by the hour up to three days and by the day past that.
 */
export function stepOf(view: AnalyticsView): UsageStep {
  if (view.period === 'now') return 'minute'
  if (view.period === 'today') return 'hour'
  if (isMomentSpan(view)) {
    const length = momentFrom(view.to).getTime() - momentFrom(view.from).getTime()
    if (length <= MINUTE_SPAN) return 'minute'
    return length <= HOUR_SPAN ? 'hour' : 'day'
  }
  return view.period === 'custom' && Boolean(view.from) && view.from === view.to ? 'hour' : 'day'
}

/** The reader's own period a view is narrowed to: its days, or the moments it runs between. */
export type OwnPeriod = Pick<AnalyticsView, 'from' | 'period' | 'to'>

/**
 * The reader's own period over the steps of an answer from `first` to `last`, both included, in
 * either order: a period pressed, or the periods a frame covers. Steps that are whole days of the
 * read's calendar give their days, as a day pressed always has; any other steps — hours, minutes,
 * or days of a span that starts inside one — give the moments from the first one's start to the
 * last one's end, that end taken up to its minute, so the minute still running stays in. Null
 * where the answer has no such steps.
 */
export function stepsSpan(usage: Usage, first: number, last: number): OwnPeriod | null {
  const start = usage.series[Math.min(first, last)]
  const end = usage.series[Math.max(first, last)]
  if (!start || !end) return null
  const midnight = named(start.start).toISOString().slice(11, 16) === '00:00'
  if (usage.period.step === 'day' && midnight)
    return { period: 'custom', from: dayOf(start.start), to: lastDayBefore(end.end) }
  const until = Math.ceil(Date.parse(end.end) / MINUTE) * MINUTE
  return momentSpan(new Date(start.start), new Date(until))
}

/** A custom period's start and end, as they first stand when it is chosen: this week's days. */
export function customDays(now: Date): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return { from: localDay(shiftDays(today, -((today.getDay() + 6) % 7))), to: localDay(today) }
}
