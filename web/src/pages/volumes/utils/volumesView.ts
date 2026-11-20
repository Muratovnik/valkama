/**
 * The view of the Volumes page and its address: the period — today, this week, the past four
 * weeks or days of the reader's own — and the filter of its tasks, a kind and a label, every task
 * when neither is chosen. The space and the project are the context bar's, never the page's.
 *
 * The read is asked for the period's days as `periodDays` names them, so today is read whole.
 */
import { TASK_KINDS } from '@/shared/api/volumesReadApi.ts'
import type { TaskKind } from '@/shared/api/volumesReadApi.ts'
import { readPeriod, writePeriod } from '@/shared/lib/periodDays.ts'
import type { PeriodView } from '@/shared/lib/periodDays.ts'

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
