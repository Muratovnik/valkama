/**
 * Whether this build reads a Work address state, or a saved view of one, as it was written.
 *
 * A view is the address state under a name, and each key of it has one reader: the view,
 * the grouping, the chain's scope and the filter. Each reads a value it does not know as
 * its default, so such a state would open as another view under the old name — a board
 * grouped by something gone opening ungrouped, a chain scope gone opening as a wrong link,
 * a filter by a kind gone narrowing nothing. A saved view one of them would read so is not
 * kept, and the menu says once which views went (`useSavedViews`); an address that holds
 * such a value is written again without it, so it says what the screen shows and a view
 * saved from it keeps nothing the next read would drop.
 */
import {
  chainTarget,
  groupingOf,
  viewOf,
  withChain,
  withGrouping,
} from '@/pages/planning/composables/usePlanningChainScope.ts'

import {
  readsEveryFilterValue,
  readWorkFilter,
  writeWorkFilter,
} from '@/entities/work-item/utils/workFilter.ts'

import type { ViewState } from '@/shared/lib/savedViews.ts'

/**
 * The state without every value a reader does not read as written, each key as its reader
 * reads it; null when every value is read. What the readers tidy in a value they do read —
 * a repeat, an empty value, a space — is left as it was written.
 */
export function withoutUnreadValues(state: ViewState | undefined): ViewState | null {
  if (state === undefined) return null
  let read: ViewState = state
  if (state.view !== undefined && viewOf(state) !== state.view)
    read = Object.fromEntries(Object.entries(read).filter(([key]) => key !== 'view'))
  if (state.group !== undefined && groupingOf(state) !== state.group)
    read = withGrouping(read, 'none')
  if (state.chain_scope !== undefined && chainTarget(state).status === 'invalid')
    read = withChain(read, null)
  if (!readsEveryFilterValue(state))
    read = writeWorkFilter(read, readWorkFilter(state), Number.POSITIVE_INFINITY).state
  return read === state ? null : read
}

export function readsSavedView(state: ViewState): boolean {
  return withoutUnreadValues(state) === null
}
