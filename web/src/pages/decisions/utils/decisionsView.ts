/**
 * The view of the Agent decisions page and its address: the period — today, this week, the past
 * four weeks or days of the reader's own (`periodDays`) — and the participation point, every
 * point when none is chosen. The space and the project are the context bar's, never the page's.
 *
 * The read is asked for the period's two moments with their offset, both ends taken in.
 */
import {
  addressDay,
  dayFrom,
  localDay,
  PERIODS,
  presetStart,
} from '@/widgets/period-bar/utils/periodDays.ts'
import type { Period } from '@/widgets/period-bar/utils/periodDays.ts'

import type { DecisionPoint } from '@/shared/api/planningDecisionPoints.ts'
import { DECISION_POINTS } from '@/shared/api/planningDecisionPoints.ts'

export interface DecisionsView {
  /** The first day of the reader's own period, `2030-03-04`; empty for a preset. */
  from: string
  period: Period
  /** The point the decisions are of; null for every point. */
  point: DecisionPoint | null
  /** The last day of the reader's own period; empty for a preset. */
  to: string
}

const DEFAULT_VIEW: DecisionsView = { from: '', period: 'week', point: null, to: '' }

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
  const period = PERIODS.find((value) => value === state?.period) ?? DEFAULT_VIEW.period
  const point = DECISION_POINTS.find((value) => value === state?.point) ?? null
  const custom = period === 'custom'
  return {
    period,
    point,
    from: custom ? addressDay(state?.from) : '',
    to: custom ? addressDay(state?.to) : '',
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
