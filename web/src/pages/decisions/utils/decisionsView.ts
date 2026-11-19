import type { DecisionPoint } from '@/shared/api/decisionsApi.ts'
/**
 * The view of the Agent decisions page and its address: the period — today, this week, the past
 * four weeks or days of the reader's own — and the participation point, every point when none is
 * chosen. The space and the project are the context bar's, never the page's.
 *
 * The period is read in the browser's own time, so a day starts at the reader's midnight, and the
 * read is asked for its two moments with their offset, both ends taken in.
 */
import { DECISION_POINTS } from '@/shared/api/planningDecisionPoints.ts'

export const DECISION_PERIODS = ['today', 'week', 'weeks4', 'custom'] as const
export type DecisionsPeriod = (typeof DECISION_PERIODS)[number]

export interface DecisionsView {
  /** The first day of the reader's own period, `2030-03-04`; empty for a preset. */
  from: string
  period: DecisionsPeriod
  /** The point the decisions are of; null for every point. */
  point: DecisionPoint | null
  /** The last day of the reader's own period; empty for a preset. */
  to: string
}

const DEFAULT_VIEW: DecisionsView = { from: '', period: 'week', point: null, to: '' }

const DAY = /^\d{4}-\d{2}-\d{2}$/u
const pad = (value: number) => String(value).padStart(2, '0')

/** A day as the browser's calendar names it: `2030-03-04`. */
export const localDay = (day: Date) =>
  `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`

/** A moment at the browser's clock with its offset, to the second: `2030-03-04T10:00:00+03:00`. */
function stamp(at: Date) {
  const offset = -at.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  return `${localDay(at)}T${time}${zone}`
}

const dayFrom = (text: string) => {
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

/** A day the address holds, or none where it holds something else. */
const day = (value: unknown) => (typeof value === 'string' && DAY.test(value) ? value : '')

/** The view an address holds; what it does not hold, or holds wrongly, is the default's. */
export function readView(state: Readonly<Record<string, string | number | boolean>> | undefined) {
  const period = DECISION_PERIODS.find((value) => value === state?.period) ?? DEFAULT_VIEW.period
  const point = DECISION_POINTS.find((value) => value === state?.point) ?? null
  const custom = period === 'custom'
  return {
    period,
    point,
    from: custom ? day(state?.from) : '',
    to: custom ? day(state?.to) : '',
  } satisfies DecisionsView
}

/** The address of a view: only what differs from the default. */
export function writeView(view: DecisionsView): Record<string, string> {
  const state: Record<string, string> = {}
  if (view.period !== DEFAULT_VIEW.period) state.period = view.period
  if (view.point) state.point = view.point
  if (view.period === 'custom') {
    if (view.from) state.from = view.from
    if (view.to) state.to = view.to
  }
  return state
}

/**
 * The two moments a view's period is read between, at `now`: today from its midnight, this week
 * from Monday's, the past four weeks from the midnight 27 days ago, each up to now; the reader's
 * own days whole. Null for days of the reader's own not yet both chosen, or the wrong way round.
 */
export function periodBounds(view: DecisionsView, now: Date): { from: string; to: string } | null {
  if (view.period === 'custom') {
    if (!view.from || !view.to || view.to < view.from) return null
    const last = dayFrom(view.to)
    last.setHours(23, 59, 59)
    return { from: stamp(dayFrom(view.from)), to: stamp(last) }
  }
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const back = { today: 0, week: (midnight.getDay() + 6) % 7, weeks4: 27 }[view.period]
  return { from: stamp(shiftDays(midnight, -back)), to: stamp(now) }
}
