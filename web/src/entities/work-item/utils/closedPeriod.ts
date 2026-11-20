/**
 * «Closed in a period», a condition of the Work filter: a card that came to be completed or
 * cancelled within the period — today, this week, the past four weeks or days of the reader's
 * own, each day whole in the reader's calendar (`periodDays`).
 *
 * It keeps exactly the cards the Volumes read counts as Done and Cancelled for the same period:
 * the period is asked of the read by its days, and a card counts there when it came to stand in
 * its finished state from the first day's midnight up to the midnight after the last (`dayBounds`).
 * That moment is the record's `closed_at`, when the card last entered its finished state, the
 * moment the read counts by. With the state category beside it, the condition is «Done in a
 * period» or «Cancelled in a period».
 *
 * The address holds it as the period pages hold theirs: `period`, and for days of the reader's
 * own `from` and `to`, the first and the last day taken in.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { dayBounds, dayOf, periodDays, PERIODS } from '@/shared/lib/periodDays.ts'
import type { PeriodView } from '@/shared/lib/periodDays.ts'

/** The period a card came to a close in; the days are empty for a preset. */
export type ClosedPeriod = PeriodView

/** The categories a card comes to a close in, as the Volumes read counts them. */
const CLOSED_CATEGORIES: ReadonlySet<string> = new Set(['completed', 'cancelled'])

/**
 * Whether a card came to be completed or cancelled within the period, at `now`. A period of the
 * reader's own whose days are not both chosen, or are the wrong way round, keeps no card.
 */
export function closedWithin(item: WorkItemBrief, closed: ClosedPeriod, now: Date): boolean {
  if (item.state === null || !CLOSED_CATEGORIES.has(item.state.category)) return false
  const days = periodDays(closed, now)
  const moment = Date.parse(item.closed_at ?? '')
  if (days === null || Number.isNaN(moment)) return false
  const { begins, ends } = dayBounds(days)
  return begins <= moment && moment < ends
}

/**
 * The period an address's three values hold, or none. A period this build does not know, or
 * days of the reader's own not both written as days, is no condition at all, as every key of
 * the filter written wrongly is read.
 */
export function readClosedPeriod(period: unknown, from: unknown, to: unknown): ClosedPeriod | null {
  const chosen = PERIODS.find((value) => value === period)
  if (chosen === undefined) return null
  if (chosen !== 'custom') return { period: chosen, from: '', to: '' }
  const [first, last] = [dayOf(from), dayOf(to)]
  return first && last ? { period: chosen, from: first, to: last } : null
}

/** Whether an address's period is one this build reads; absent is no condition, and reads. */
export const readsClosedPeriod = (period: unknown) =>
  period === undefined || (PERIODS as readonly unknown[]).includes(period)
