/**
 * The periods work is counted by, in the browser's own calendar: today, this week from Monday,
 * the past four weeks, or days of the reader's own. A day starts at the reader's midnight, and a
 * day is named as that calendar names it, `2030-03-04`.
 *
 * `periodDays` is how a read by days is asked for one: from the first day to the day after the
 * last, which the read does not take in, at the reader's offset from UTC that day, as the
 * Volumes read's grammar names a period. So whatever counts by a period here counts the days
 * the Volumes read counts.
 */

export const PERIODS = ['today', 'week', 'weeks4', 'custom'] as const
type Period = (typeof PERIODS)[number]

const DAY = /^\d{4}-\d{2}-\d{2}$/u
const pad = (value: number) => String(value).padStart(2, '0')

/** A day as the browser's calendar names it: `2030-03-04`. */
export const localDay = (day: Date) =>
  `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`

/** The midnight a day's name stands for, in the browser's own time. */
const dayFrom = (text: string) => {
  const [year, month, date] = text.split('-').map(Number)
  return new Date(year, month - 1, date)
}

/** The day `days` after (or before) `day`, at its midnight. */
const shiftDays = (day: Date, days: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate() + days)

/** The days a custom period first stands at: the week up to today. */
export const customDays = (now: Date) => ({
  from: localDay(shiftDays(now, -6)),
  to: localDay(now),
})

/** A day a text names, or none where it names something else. */
export const dayOf = (value: unknown) => (typeof value === 'string' && DAY.test(value) ? value : '')

/**
 * The midnight a preset period starts at, on the day of `now`: today's, Monday's of this week, or
 * the one 27 days back for the past four weeks.
 */
function presetStart(period: Exclude<Period, 'custom'>, now: Date): Date {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const back = { today: 0, week: (midnight.getDay() + 6) % 7, weeks4: 27 }[period]
  return shiftDays(midnight, -back)
}

/** A period as an address holds it: the period, and the days of the reader's own. */
export interface PeriodView {
  /** The first day of the reader's own period, `2030-03-04`; empty for a preset. */
  from: string
  period: Period
  /** The last day of the reader's own period; empty for a preset. */
  to: string
}

/**
 * The days a period is read between, at `now`: from its first day to the day after its last,
 * and the reader's offset from UTC that day, in minutes east. A preset runs to the end of today.
 * Null for days of the reader's own not yet both chosen, or the wrong way round.
 */
export function periodDays(
  view: PeriodView,
  now: Date,
): { from: string; to: string; utcOffset: number } | null {
  const utcOffset = -now.getTimezoneOffset()
  if (view.period === 'custom') {
    return !view.from || !view.to || view.to < view.from
      ? null
      : { from: view.from, to: localDay(shiftDays(dayFrom(view.to), 1)), utcOffset }
  }
  return {
    from: localDay(presetStart(view.period, now)),
    to: localDay(shiftDays(now, 1)),
    utcOffset,
  }
}

/**
 * The two moments a read by days stands between, in milliseconds since the epoch: the first
 * day's midnight and the midnight that ends it, both at the one offset, as the server reads a
 * day it is named (`usage.period`). The first is in the period, the second is not.
 */
export function dayBounds(days: { from: string; to: string; utcOffset: number }) {
  const at = (day: string) => {
    const [year, month, date] = day.split('-').map(Number)
    return Date.UTC(year, month - 1, date) - days.utcOffset * 60_000
  }
  return { begins: at(days.from), ends: at(days.to) }
}
