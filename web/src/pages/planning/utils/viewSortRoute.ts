/**
 * The order of the Work views as the address keeps it: `sort`, a key the views
 * know, and `desc`, true when it reads from the end. No `sort` is the queue's
 * order, the default; no `desc` reads from the start. A column header of the list
 * and the menu «View» write the same two keys, so a saved view keeps whichever set
 * them, and a reload comes back to it.
 */
import { QUEUE_ORDER, VIEW_SORT_KEYS } from '@/widgets/work-item-views/utils/workOrder.ts'
import type { ViewSort, ViewSortKey } from '@/widgets/work-item-views/utils/workOrder.ts'

type RouteState = Record<string, string | number | boolean>

const known = (value: unknown): value is ViewSortKey =>
  typeof value === 'string' && (VIEW_SORT_KEYS as readonly string[]).includes(value)

/**
 * The order the state holds. A key this build does not know reads as the queue's
 * order, and its direction with it, as any value a reader does not know reads as
 * its default.
 */
export function sortOf(state: RouteState | undefined): ViewSort {
  const key = state?.sort
  if (key === undefined) return { ...QUEUE_ORDER, descending: state?.desc === true }
  return known(key) ? { key, descending: state?.desc === true } : QUEUE_ORDER
}

/** Whether the state's `sort` and `desc` are ones this build reads; a state with neither is read. */
export function readsSort(state: RouteState | undefined): boolean {
  return (
    (state?.sort === undefined || known(state.sort)) &&
    (state?.desc === undefined || typeof state.desc === 'boolean')
  )
}

/** The same state ordered so; the defaults leave their keys out. */
export function withSort(state: RouteState | undefined, sort: ViewSort): RouteState {
  const rest = Object.fromEntries(
    Object.entries(state ?? {}).filter(([key]) => key !== 'sort' && key !== 'desc'),
  )
  return {
    ...rest,
    ...(sort.key === 'queue' ? {} : { sort: sort.key }),
    ...(sort.descending ? { desc: true } : {}),
  }
}
