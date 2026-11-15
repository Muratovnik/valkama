/**
 * Whether this build reads a saved Work view as it was saved.
 *
 * A view is the address state under a name, and each key of it has one reader: the view,
 * the grouping, the chain's scope and the filter. Each reads a value it does not know as
 * its default, so such a view applied would open as another view under the old name — a
 * board grouped by something gone opening ungrouped, a chain scope gone opening as a wrong
 * link, a filter by a kind gone narrowing nothing. A view one of them would read so is not
 * kept, and the menu says once which views went (`useSavedViews`).
 */
import {
  chainTarget,
  groupingOf,
  viewOf,
} from '@/pages/planning/composables/usePlanningChainScope.ts'

import { readsEveryFilterValue } from '@/entities/work-item/utils/workFilter.ts'

import type { ViewState } from '@/shared/lib/savedViews.ts'

export function readsSavedView(state: ViewState): boolean {
  if (state.view !== undefined && viewOf(state) !== state.view) return false
  if (state.group !== undefined && groupingOf(state) !== state.group) return false
  if (state.chain_scope !== undefined && chainTarget(state).status === 'invalid') return false
  return readsEveryFilterValue(state)
}
