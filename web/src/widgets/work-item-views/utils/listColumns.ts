/**
 * The list's columns: what each sorts by, and which of them give way to the
 * title when the list is too narrow to stand them all side by side.
 *
 * A column that gives way is not dropped. Its value moves under the title as
 * a fact and its sort into the title's heading, so the row still says it and
 * the list can still be ordered by it.
 */
import { holderRef } from '@/entities/work-item/utils/facets.ts'

import { PRIORITIES } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

export type SortKey =
  'reference' | 'title' | 'state' | 'priority' | 'claim' | 'checklist' | 'updated'

/** How much of the table the list's width holds: every column, all but three, or the reference and the title. */
export type Fit = 'wide' | 'medium' | 'narrow'

export interface ListColumn {
  key: SortKey
  label: string
  numeric?: boolean
}

export const LIST_COLUMNS: readonly ListColumn[] = [
  // The reference starts after its glyph slots, so its heading starts where they do.
  { key: 'reference', label: 'workItem.list.reference' },
  { key: 'title', label: 'workItem.list.title' },
  { key: 'state', label: 'workItem.list.state' },
  { key: 'priority', label: 'workItem.list.priority' },
  { key: 'claim', label: 'workItem.list.claim' },
  { key: 'checklist', label: 'workItem.list.checklist', numeric: true },
  { key: 'updated', label: 'workItem.list.updated' },
]

/**
 * The columns each fit folds under the title. The steps and the date stay
 * columns longest, because they are compared down the list; the state, the
 * priority and the holder read as well as a line under the title, the state
 * still marked by its dot, and leave a long title its second line.
 */
const FOLDED: Record<Fit, ReadonlySet<SortKey>> = {
  wide: new Set(),
  medium: new Set(['state', 'priority', 'claim']),
  narrow: new Set(['state', 'priority', 'claim', 'checklist', 'updated']),
}

export function isFolded(fit: Fit, key: SortKey): boolean {
  return FOLDED[fit].has(key)
}

/**
 * The fit for a list `width` pixels wide; unmeasured, the list is wide. The
 * thresholds are where the columns that stay leave the title room for a
 * typical title on two lines.
 */
export function fitFor(width: number): Fit {
  if (width === 0 || width >= 900) return 'wide'
  return width >= 560 ? 'medium' : 'narrow'
}

const urgency = new Map(PRIORITIES.map((priority, index) => [priority, PRIORITIES.length - index]))

function stepsOf(item: WorkItemBrief): { done: number; total: number } {
  return {
    done: item.checklist.filter((step) => step.done).length,
    total: item.checklist.length,
  }
}

function sortValue(item: WorkItemBrief, key: SortKey): number | string {
  if (key === 'reference') return item.number
  if (key === 'title') return item.title.toLocaleLowerCase()
  if (key === 'state') return item.state.name.toLocaleLowerCase()
  if (key === 'priority') return urgency.get(item.priority) ?? 0
  if (key === 'claim') return holderRef(item).toLocaleLowerCase()
  if (key === 'checklist') {
    const { done, total } = stepsOf(item)
    return total ? done / total : -1
  }
  return item.updated_at
}

/** The items ordered by `key`, ties broken by number so the order is stable. */
export function sortedRows(
  items: readonly WorkItemBrief[],
  key: SortKey,
  descending: boolean,
): WorkItemBrief[] {
  const direction = descending ? -1 : 1
  return [...items].sort((left, right) => {
    const a = sortValue(left, key)
    const b = sortValue(right, key)
    if (a === b) return left.number - right.number
    return (a > b ? 1 : -1) * direction
  })
}
