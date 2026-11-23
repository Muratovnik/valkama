/**
 * Where a number on top of the Volumes page opens, with the filter that shows its cards.
 *
 * A space's or a project's open category opens its board in the same scope, narrowed to the
 * category, since a space's read holds the items its board holds. A filter of the page is the
 * board's too, and its rules are the board's (any of the kinds, every label); since the page's
 * filter counts tasks alone, a filter by label alone names the three kinds of a task, so no goal
 * or stage carrying the label comes in.
 *
 * Done and Cancelled count what came to a close in the page's period, so they open the Work list,
 * ungrouped, with the condition «Closed in a period» for that period beside the category
 * (`closedPeriod`): its days are the page's, counted by the one day rule (`periodDays`). The
 * condition's `period` is always written, since where the page reads none as a week, the filter
 * reads none as no condition.
 *
 * Some numbers open nothing, and say why (`reason`): every space has no board of its own, the
 * portfolio standing there instead (`global`). «Waiting for me» counts questions rather than
 * cards, two questions on one card being two, so it opens the questions window in either scope.
 * «Commits on no card» shows their list on the page itself (`commits`).
 */
import { writeWorkFilter } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import type { STATE_CATEGORIES } from '@/shared/api/planningModel.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import { TASK_KINDS } from '@/shared/api/volumesReadApi.ts'
import type { TaskKind } from '@/shared/api/volumesReadApi.ts'
import type { PeriodView } from '@/shared/lib/periodDays.ts'

type Category = (typeof STATE_CATEGORIES)[number]

/** What a number opens: the board, the list, the questions window, or nothing, and why. */
export type VolumesTarget =
  | { kind: 'board'; route: PlatformRoute }
  | { kind: 'list'; route: PlatformRoute }
  | { kind: 'none'; reason: 'global' }
  | { kind: 'commits' }
  | { kind: 'questions' }

/** The page's filter of tasks, as the read was asked for it, and its period. */
interface PageFilter extends PeriodView {
  kind: TaskKind | null
  label: string | null
}

/** The categories that count what came to stand in them in the period, not what stands there now. */
export const CLOSED: readonly Category[] = ['completed', 'cancelled']

/**
 * The Work filter for the page's filter, with the category beside it, and for a closed category
 * the page's period. A filter of the page this size always fits the address whole, so the bound
 * is no bound.
 */
function workState(filter: PageFilter, category: Category) {
  let kinds: TaskKind[] = []
  if (filter.kind) kinds = [filter.kind]
  else if (filter.label) kinds = [...TASK_KINDS]
  const { period, from, to } = filter
  const work: WorkFilter = {
    text: '',
    category: [category],
    ...(CLOSED.includes(category) ? { closed: { period, from, to } } : {}),
    ...(kinds.length ? { kind: kinds } : {}),
    ...(filter.label ? { labels: [filter.label] } : {}),
  }
  return writeWorkFilter(undefined, work, Number.MAX_SAFE_INTEGER).state
}

/** What a category's number opens in a scope, under the page's filter and period. */
export function categoryTarget(
  scope: OperatingScope,
  category: Category,
  filter: PageFilter,
): VolumesTarget {
  if (scope.kind !== 'space') return { kind: 'none', reason: 'global' }
  const state = workState(filter, category)
  return CLOSED.includes(category)
    ? { kind: 'list', route: { module_id: 'planning', scope, state: { ...state, view: 'list' } } }
    : { kind: 'board', route: { module_id: 'planning', scope, state } }
}

/** What «Waiting for me» opens, in either scope. */
export const WAITING_TARGET: VolumesTarget = { kind: 'questions' }

/** What «Commits on no card» opens: their list, under the numbers. */
export const COMMITS_TARGET: VolumesTarget = { kind: 'commits' }
