/**
 * The view of the Volumes page and its address: the period — today, this week, the past four
 * weeks or days of the reader's own (`periodDays`) — and the filter of its tasks, a kind and a
 * label, every task when neither is chosen. The space and the project are the context bar's,
 * never the page's.
 *
 * The read is asked for the period as days of the reader's calendar at the reader's offset from
 * UTC: from the first day's midnight to the midnight after the last, which the read does not
 * take in, so today is read whole.
 */
import {
  dayFrom,
  localDay,
  presetStart,
  readPeriod,
  shiftDays,
  writePeriod,
} from '@/widgets/period-bar/utils/periodDays.ts'
import type { PeriodView } from '@/widgets/period-bar/utils/periodDays.ts'

import { TASK_KINDS } from '@/shared/api/volumesReadApi.ts'
import type { TaskKind } from '@/shared/api/volumesReadApi.ts'

export interface VolumesView extends PeriodView {
  /** The kind of task the read keeps; null for every kind. */
  kind: TaskKind | null
  /** The label every task the read keeps carries; null for any. */
  label: string | null
}

/** The period a view stands at until the reader chooses another. */
const DEFAULT_PERIOD = 'week'

/** The longest label an address carries, as the read's contract bounds a label. */
const LABEL_CHARS = 64

type RouteState = Readonly<Record<string, string | number | boolean>>

/** The view an address holds; what it does not hold, or holds wrongly, is the default's. */
export function readView(state: RouteState | undefined): VolumesView {
  const kind = TASK_KINDS.find((value) => value === state?.kind) ?? null
  const label =
    typeof state?.label === 'string' && state.label.length > 0 && state.label.length <= LABEL_CHARS
      ? state.label
      : null
  return { ...readPeriod(state, DEFAULT_PERIOD), kind, label }
}

/** The address of a view: only what differs from the default. */
export function writeView(view: VolumesView): Record<string, string> {
  return {
    ...writePeriod(view, DEFAULT_PERIOD),
    ...(view.kind ? { kind: view.kind } : {}),
    ...(view.label ? { label: view.label } : {}),
  }
}

/**
 * The days a view's period is read between, at `now`: from its first day to the day after its
 * last, and the reader's offset from UTC that day. Null for days of the reader's own not yet both
 * chosen, or the wrong way round.
 */
export function periodDays(
  view: VolumesView,
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
