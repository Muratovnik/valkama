/**
 * The period a view's figures are compared with, when the read's own `compare` — the period of
 * the same length right before — would compare unlike days.
 *
 * «This week» runs from Monday to now, so the period of its length right before it is the end of
 * the week before: Wednesday afternoon would be held against Friday to Sunday. It is compared
 * with the same days of the week before instead, from that Monday's midnight to the same weekday
 * and time, each in the browser's own time. The past four weeks and a custom period keep the
 * read's own comparison, which is like for like.
 *
 * The read writes a period's bounds at the offset it is asked at, and the page names the period
 * by them. That week is asked at the offset its own Monday had, not today's: in the week after a
 * change of time, today's offset would write that Monday's midnight as eleven the evening before
 * or one in the morning, and the words would name a day early or late.
 */
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'

import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'

const WEEK = 7

/** The same days of the week before for «this week» at `now`; null for any other period. */
export function comparedPeriod(view: AnalyticsView, now: Date): PeriodBounds | null {
  if (view.period !== 'week') return null
  const intoWeek = (now.getDay() + 6) % 7
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - intoWeek - WEEK)
  const sameMoment = new Date(now)
  sameMoment.setDate(now.getDate() - WEEK)
  return {
    from: monday.toISOString(),
    to: sameMoment.toISOString(),
    utcOffset: -monday.getTimezoneOffset(),
  }
}
