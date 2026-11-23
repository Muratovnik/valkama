/**
 * The view of the Agent decisions page and its address: the period — today, this week, the past
 * four weeks or days of the reader's own (`periodDays`) — and the participation point, every
 * point when none is chosen. The space and the project are the context bar's, never the page's.
 *
 * The read is asked for the period's two moments with their offset, both ends taken in.
 */
import type { DecisionPoint } from '@/shared/api/planningDecisionPoints.ts'
import { DECISION_POINTS } from '@/shared/api/planningDecisionPoints.ts'
import { dayFrom, localDay, presetStart, readPeriod, writePeriod } from '@/shared/lib/periodDays.ts'
import type { PeriodView } from '@/shared/lib/periodDays.ts'

export interface DecisionsView extends PeriodView {
  /** The point the decisions are of; null for every point. */
  point: DecisionPoint | null
}

/** The period a view stands at until the reader chooses another. */
const DEFAULT_PERIOD = 'week'

const pad = (value: number) => String(value).padStart(2, '0')

/** A moment at the browser's clock with its offset, to the second: `2030-03-04T10:00:00+03:00`. */
function stamp(at: Date) {
  const offset = -at.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  const zone = `${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`
  return `${localDay(at)}T${time}${zone}`
}

/** The view an address holds; what it does not hold, or holds wrongly, is the default's. */
export function readView(state: Readonly<Record<string, string | number | boolean>> | undefined) {
  const point = DECISION_POINTS.find((value) => value === state?.point) ?? null
  return { ...readPeriod(state, DEFAULT_PERIOD), point } satisfies DecisionsView
}

/** The address of a view: only what differs from the default. */
export function writeView(view: DecisionsView): Record<string, string> {
  return { ...writePeriod(view, DEFAULT_PERIOD), ...(view.point ? { point: view.point } : {}) }
}

/**
 * The two moments a view's period is read between, at `now`: a preset from its midnight up to
 * now, the reader's own days whole. Null for days of the reader's own not yet both chosen, or the
 * wrong way round.
 */
export function periodBounds(view: DecisionsView, now: Date): { from: string; to: string } | null {
  if (view.period === 'custom') {
    if (!view.from || !view.to || view.to < view.from) return null
    const last = dayFrom(view.to)
    last.setHours(23, 59, 59)
    return { from: stamp(dayFrom(view.from)), to: stamp(last) }
  }
  return { from: stamp(presetStart(view.period, now)), to: stamp(now) }
}
