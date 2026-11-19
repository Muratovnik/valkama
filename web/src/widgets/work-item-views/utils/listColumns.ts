/**
 * The list's columns: what each sorts by, and which of them give way to the
 * title when the list is too narrow to stand them all side by side.
 *
 * «Goal and stage» names the containers a row stands under, the goal first. A tree
 * shows them by where it puts the row, so the list grouped by goal does not draw it
 * (`drawnColumns`); the flat list and the list by project do.
 *
 * A column that gives way is not dropped. Its value moves under the title as
 * a fact and its sort into the title's heading, so the row still says it and
 * the list can still be ordered by it.
 */
import { holderRef } from '@/entities/work-item/utils/facets.ts'
import { goalPath } from '@/entities/work-item/utils/workTree.ts'

import { PRIORITIES } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { StandingItem } from '@/shared/lib/standing.ts'

export type SortKey =
  'reference' | 'title' | 'goal' | 'state' | 'priority' | 'claim' | 'checklist' | 'updated'

/**
 * How much of the table the list's width holds: every column; all but «Goal and
 * stage»; all but the four that read as a line under the title; or the reference
 * and the title.
 */
export type Fit = 'full' | 'wide' | 'medium' | 'narrow'

export interface ListColumn {
  key: SortKey
  label: string
  numeric?: boolean
}

export const LIST_COLUMNS: readonly ListColumn[] = [
  // The reference starts after its glyph slots, so its heading starts where they do.
  { key: 'reference', label: 'workItem.list.reference' },
  { key: 'title', label: 'workItem.list.title' },
  { key: 'goal', label: 'workItem.list.goal' },
  { key: 'state', label: 'workItem.list.state' },
  { key: 'priority', label: 'workItem.list.priority' },
  { key: 'claim', label: 'workItem.list.claim' },
  { key: 'checklist', label: 'workItem.list.checklist', numeric: true },
  { key: 'updated', label: 'workItem.list.updated' },
]

/**
 * The columns each fit folds under the title. The steps and the date stay
 * columns longest, because they are compared down the list; the goal and stage,
 * the state, the priority and the holder read as well as a line under the title,
 * the state still marked by its dot, and leave a long title its second line.
 * «Goal and stage» gives way first: standing beside every other column in a list
 * 900px wide, it left the title 20 characters and pushed the table past the
 * list's edge.
 */
const FOLDED: Record<Fit, ReadonlySet<SortKey>> = {
  full: new Set(),
  wide: new Set(['goal']),
  medium: new Set(['goal', 'state', 'priority', 'claim']),
  narrow: new Set(['goal', 'state', 'priority', 'claim', 'checklist', 'updated']),
}

export function isFolded(fit: Fit, key: SortKey): boolean {
  return FOLDED[fit].has(key)
}

/** Whether a list of this fit prints an open blocker and the labels under a title, not a line of facts. */
export const labelsUnder = (fit: Fit): boolean => fit === 'full' || fit === 'wide'

/** The columns a list draws: all but «Goal and stage» in the tree by goal, which shows it. */
export const drawnColumns = (tree: boolean): readonly ListColumn[] =>
  tree ? LIST_COLUMNS.filter((column) => column.key !== 'goal') : LIST_COLUMNS

/**
 * The fit for a list `width` pixels wide; unmeasured, the list is wide. The
 * thresholds are where the columns that stay leave the title room for a
 * typical title on two lines.
 */
export function fitFor(width: number): Fit {
  if (width === 0 || width >= 1100) return 'full'
  if (width >= 900) return 'wide'
  return width >= 560 ? 'medium' : 'narrow'
}

const urgency = new Map(PRIORITIES.map((priority, index) => [priority, PRIORITIES.length - index]))

function stepsOf(item: WorkItemBrief): { done: number; total: number } {
  return {
    done: item.checklist.filter((step) => step.done).length,
    total: item.checklist.length,
  }
}

/** How a row's state reads, which is what the state column sorts by. */
type StateName = (item: StandingItem) => string

/** The work rows are named in, by id: where a row's goal and stage are found. */
type ById = ReadonlyMap<string, WorkItemBrief>

function sortValue(
  item: WorkItemBrief,
  key: SortKey,
  stateName: StateName,
  byId: ById,
): number | string {
  if (key === 'reference') return item.number
  if (key === 'title') return item.title.toLocaleLowerCase()
  // Work under no goal sorts before every goal's, as an empty string does.
  if (key === 'goal') return goalPath(item, byId).join(' › ').toLocaleLowerCase()
  if (key === 'state') return stateName(item).toLocaleLowerCase()
  if (key === 'priority') return urgency.get(item.priority) ?? 0
  if (key === 'claim') return holderRef(item).toLocaleLowerCase()
  if (key === 'checklist') {
    const { done, total } = stepsOf(item)
    return total ? done / total : -1
  }
  return item.updated_at
}

/**
 * The items ordered by `key`, ties broken by number so the order is stable; a row's
 * goal and stage are read from `space`, which holds them where a filter left them out.
 */
export function sortedRows(
  items: readonly WorkItemBrief[],
  { descending, key }: { descending: boolean; key: SortKey },
  stateName: StateName,
  space: readonly WorkItemBrief[] = items,
): WorkItemBrief[] {
  const direction = descending ? -1 : 1
  const byId: ById =
    key === 'goal' ? new Map(space.map((item) => [item.work_item_id, item])) : new Map()
  return [...items].sort((left, right) => {
    const a = sortValue(left, key, stateName, byId)
    const b = sortValue(right, key, stateName, byId)
    if (a === b) return left.number - right.number
    return (a > b ? 1 : -1) * direction
  })
}
