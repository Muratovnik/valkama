/**
 * The order the board and the list draw work in: the queue's, by default, or a
 * column's, each either way round.
 *
 * The queue order is the one the take-next queue gives work in: a task the queue
 * gives stands by its place there (`queue_order`), first given first. A goal or a
 * stage is never given, so it stands by the place of the earliest task under it
 * that is. What the queue does not give follows, in the order the server listed it,
 * and a goal or stage with no task in the queue comes after that, by its number.
 *
 * Every other key is a column's (`listColumns.ts`) or the time the work was filed,
 * which has no column of its own; a tie goes to the smaller number, so the order is
 * stable.
 */
import { sortedRows } from '@/widgets/work-item-views/utils/listColumns.ts'
import type { SortKey } from '@/widgets/work-item-views/utils/listColumns.ts'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { StandingItem } from '@/shared/lib/standing.ts'

/** What the views can be ordered by. */
export type ViewSortKey = SortKey | 'created' | 'queue'

export interface ViewSort {
  descending: boolean
  key: ViewSortKey
}

/** The default order: the queue's, first given first. */
export const QUEUE_ORDER: ViewSort = Object.freeze({ key: 'queue', descending: false })

/** Every key the views know, the queue's first. */
export const VIEW_SORT_KEYS: readonly ViewSortKey[] = [
  'queue',
  'updated',
  'created',
  'priority',
  'reference',
  'title',
  'goal',
  'project',
  'state',
  'claim',
  'checklist',
]

/**
 * Which way a key reads first when it is picked: the columns people scan for what
 * changed, what was filed last and what is urgent newest and highest first; the queue
 * and a name from the start.
 */
export function firstDirection(key: ViewSortKey): boolean {
  return key === 'updated' || key === 'created' || key === 'priority' || key === 'checklist'
}

/**
 * The order a sort by `key` asks for from `now`: the same key turns the order over; another
 * starts from the end it reads first (`firstDirection`).
 */
export function nextSort(now: ViewSort, key: ViewSortKey): ViewSort {
  return now.key === key
    ? { key, descending: !now.descending }
    : { key, descending: firstDirection(key) }
}

/** A row's place in its space's queue, which only a row of a list read carries. */
const queuePlace = (item: WorkItemBrief & { queue_order?: number | null }) =>
  item.queue_order ?? null

/**
 * Each item's place in the queue order: a task's own, a container's earliest task's
 * under it at any depth, read over `scope`, which holds the tree the items stand in.
 */
function queueRanks(scope: readonly WorkItemBrief[]): Map<string, number> {
  const byId = new Map(scope.map((item) => [item.work_item_id, item]))
  const ranks = new Map<string, number>()
  for (const item of scope) {
    const place = queuePlace(item)
    if (place === null) continue
    ranks.set(item.work_item_id, place)
    const seen = new Set([item.work_item_id])
    let parent = item.parent_id === null ? undefined : byId.get(item.parent_id)
    while (parent !== undefined && !seen.has(parent.work_item_id)) {
      seen.add(parent.work_item_id)
      const held = ranks.get(parent.work_item_id)
      if (held === undefined || place < held) ranks.set(parent.work_item_id, place)
      parent = parent.parent_id === null ? undefined : byId.get(parent.parent_id)
    }
  }
  return ranks
}

/** The items in the queue order, or turned over. */
function byQueue(
  items: readonly WorkItemBrief[],
  scope: readonly WorkItemBrief[],
  descending: boolean,
): WorkItemBrief[] {
  const ranks = queueRanks(scope)
  const listed = new Map(items.map((item, at) => [item.work_item_id, at]))
  const key = (item: WorkItemBrief): [number, number] => {
    const rank = ranks.get(item.work_item_id)
    if (rank !== undefined) return [0, rank]
    if (WORK_ITEM_TREE.isContainer(item)) return [2, item.number]
    return [1, listed.get(item.work_item_id) ?? 0]
  }
  const direction = descending ? -1 : 1
  return [...items].sort((left, right) => {
    const [a, b] = [key(left), key(right)]
    return (a[0] - b[0] || a[1] - b[1] || left.number - right.number) * direction
  })
}

/** Older first, and of one moment the lower number first, as they were filed. */
function byCreated(left: WorkItemBrief, right: WorkItemBrief): number {
  if (left.created_at !== right.created_at) return left.created_at > right.created_at ? 1 : -1
  return left.number - right.number
}

/** What the items are ordered within: the work beyond them a sort reads. */
interface OrderedWithin {
  /** What a container's place in the queue is read over; the items themselves when absent. */
  scope?: readonly WorkItemBrief[]
  /** Where an item's goal and stages are found; the scope when absent. */
  space?: readonly WorkItemBrief[]
}

/** The items in the order `sort` says; `stateName` is how the state column reads a state. */
export function orderedWork(
  items: readonly WorkItemBrief[],
  sort: ViewSort,
  stateName: (item: StandingItem) => string,
  { scope = items, space = scope }: OrderedWithin = {},
): WorkItemBrief[] {
  if (sort.key === 'queue') return byQueue(items, scope, sort.descending)
  if (sort.key !== 'created') return sortedRows(items, { ...sort, key: sort.key }, stateName, space)
  const direction = sort.descending ? -1 : 1
  return [...items].sort((left, right) => byCreated(left, right) * direction)
}
