/**
 * The periods a page on the period bar (`PeriodBar`) is read by, in the browser's own calendar:
 * today, this week from Monday, the past four weeks, or days of the reader's own. A day starts at
 * the reader's midnight, and a day is named as that calendar names it, `2030-03-04`.
 *
 * The page keeps its view and its address; these are the days every such page counts the same
 * way, so two pages on the bar never disagree over where this week began.
 */

export const PERIODS = ['today', 'week', 'weeks4', 'custom'] as const
export type Period = (typeof PERIODS)[number]

const DAY = /^\d{4}-\d{2}-\d{2}$/u
const pad = (value: number) => String(value).padStart(2, '0')

/** A day as the browser's calendar names it: `2030-03-04`. */
export const localDay = (day: Date) =>
  `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`

/** The midnight a day's name stands for, in the browser's own time. */
export const dayFrom = (text: string) => {
  const [year, month, date] = text.split('-').map(Number)
  return new Date(year, month - 1, date)
}

const shiftDays = (day: Date, days: number) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate() + days)

/** The days a custom period first stands at: the week up to today. */
export const customDays = (now: Date) => ({
  from: localDay(shiftDays(now, -6)),
  to: localDay(now),
})

/** A day an address holds, or none where it holds something else. */
export const addressDay = (value: unknown) =>
  typeof value === 'string' && DAY.test(value) ? value : ''

/**
 * The midnight a preset period starts at, on the day of `now`: today's, Monday's of this week, or
 * the one 27 days back for the past four weeks.
 */
export function presetStart(period: Exclude<Period, 'custom'>, now: Date): Date {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const back = { today: 0, week: (midnight.getDay() + 6) % 7, weeks4: 27 }[period]
  return shiftDays(midnight, -back)
}
