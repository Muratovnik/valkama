/**
 * What the list draws differently as a tree, for each row: the indent and the
 * arrow at its start, the quiet tone of a path row with the count of what
 * matched under it, the parent the tree does not show, and the names a reader
 * hears. A flat list asks the same and is told nothing.
 *
 * The indent is `TreeRowLead`'s: a step is the arrow's 16px square and the 8px
 * after it, 16px in all on a narrow list, which also stops the indent at its
 * third level rather than its fifth. The widest reference of a tree is found
 * after its indent (`indentOf`), so the first column is as wide as a deep row
 * needs.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { useListTree } from '@/widgets/work-item-views/composables/useListTree.ts'
import type { SpaceProject } from '@/widgets/work-item-views/utils/boardLanes.ts'
import {
  isGroupRow,
  listProjectGroups,
  listSpaceGroups,
} from '@/widgets/work-item-views/utils/listGroups.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { TreeRow } from '@/shared/lib/treeRows.ts'
import type { ListFocus } from '@/shared/ui/useListKeys.ts'

/**
 * A tree's whole scope before the filter, whether one is in force, and its space;
 * grouped by project, the space's projects its groups are.
 */
export interface ListTreeScope {
  filtered: boolean
  scope: WorkItemBrief[]
  space: string
  grouping?: 'goal' | 'project'
  projects?: readonly SpaceProject[] | null
}

interface ListTreeRows {
  /** What the filter let through. */
  items: () => readonly WorkItemBrief[]
  narrow: () => boolean
  /** The rows' items in the list's order. */
  ordered: () => readonly WorkItemBrief[]
  /** The tree, or null for a flat list; which of the two is read once, as the list is made. */
  tree: () => ListTreeScope | null
}

/** The indent's levels and step, on a list and on a narrow one. */
const WIDE = { levels: 5, step: 24 }
const NARROW = { levels: 3, step: 16 }

export function useListTreeRows({ items, narrow, ordered, tree: live }: ListTreeRows) {
  const { t } = useI18n()
  const matched = computed(() =>
    live()?.filtered ? new Set(items().map((item) => item.work_item_id)) : null,
  )
  const groups = computed(() => {
    const scope = live()
    if (!scope) return null
    return scope.grouping === 'project'
      ? listProjectGroups(scope.scope, scope.projects, t)
      : listSpaceGroups(scope.scope, t)
  })
  const tree = live()
    ? useListTree({
        items: () => groups.value?.items ?? live()?.scope ?? [],
        matches: () => matched.value,
        ordered,
        space: () => live()?.space ?? '',
        source: () => groups.value?.source,
      })
    : null

  const levels = computed(() => (narrow() ? NARROW.levels : WIDE.levels))
  const step = computed(() => (narrow() ? NARROW.step : WIDE.step))

  const treeOf = (item: WorkItemBrief) => tree?.rowOf(item)
  const ids = useId()
  const refId = (item: WorkItemBrief) => `${ids}-ref-${item.work_item_id}`
  const nameId = (item: WorkItemBrief) => `${ids}-name-${item.work_item_id}`

  return {
    /** A tree's cells take focus from the keys, out of the Tab order. */
    cellTab: tree ? -1 : undefined,
    focus: (tree
      ? {
          kind: 'row',
          tree: { expanded: tree.expanded, parentOf: tree.parentOf, toggle: tree.toggle },
        }
      : { kind: 'opener' }) satisfies ListFocus as ListFocus,
    indentOf: (item: WorkItemBrief) =>
      tree ? Math.min(tree.depthOf(item), levels.value - 1) * step.value : 0,
    /**
     * What the first column takes before its widest reference beyond a flat list's: the
     * arrow's step and the deepest row's indent, as a list too wide to be narrow draws
     * them, which is the list the room decides about (`fitFor`).
     */
    lead: () => (tree ? (Math.min(tree.deepest(), WIDE.levels - 1) + 1) * WIDE.step : 0),
    /** What a group's row counts, as a lane's heading does. */
    groupCounts(item: WorkItemBrief): string {
      const { open, closed } = groups.value?.counts.get(item.work_item_id) ?? { open: 0, closed: 0 }
      return t('workItem.lanes.counts', { closed, total: open + closed })
    },
    /** A group's row, which no card is: it folds and opens nothing (`listGroups`). */
    isGroup: isGroupRow,
    isPath: (item: WorkItemBrief) => treeOf(item)?.context === true,
    isTree: tree !== null,
    /** What names a row to the keys and a press: a card's reference, a group's own id. */
    referenceOf: (item: WorkItemBrief) => (isGroupRow(item) ? item.work_item_id : item.reference),
    /** What a path row is, for a reader: the tone that says it is not read. */
    describedBy: (row: TreeRow<WorkItemBrief>) => (row.context ? t('tree.path') : undefined),
    labelledBy: (item: WorkItemBrief) =>
      isGroupRow(item) ? nameId(item) : `${refId(item)} ${nameId(item)}`,
    /** «3 match» on a row a filter found something under. */
    matchingOf(item: WorkItemBrief): string {
      const inside = live()?.filtered ? (treeOf(item)?.matchesInside ?? 0) : 0
      return inside ? t('tree.matching', { count: inside }, inside) : ''
    },
    /** What a tree's row is drawn by beyond its item. */
    memoOf(item: WorkItemBrief): unknown[] {
      const row = treeOf(item)
      return [row?.depth, row?.expanded, row?.posInSet, row?.setSize, row?.matchesInside]
    },
    nameId,
    refId,
    rows: computed(() => tree?.rows.value ?? ordered()),
    /** Where a tree's row starts: its depth, shown or folded away, and whether it is open. */
    treeLead: (item: WorkItemBrief) =>
      tree
        ? {
            depth: treeOf(item)?.depth ?? tree.depthOf(item),
            expanded: treeOf(item)?.expanded ?? null,
            levels: levels.value,
          }
        : null,
    treeOf,
    /**
     * The parent the tree does not show: of a row deeper than the indent goes, and of
     * another space's card in its space's group, whose parent lies in its own space and
     * which the read names by reference.
     */
    underOf(item: WorkItemBrief): string {
      const row = treeOf(item)
      if (!tree || !row) return ''
      if (item.other_space && live()?.grouping !== 'project')
        return item.parent ? t('tree.under', { reference: item.parent }) : ''
      if (row.depth < levels.value) return ''
      const parent = tree.parentItem(row)
      return parent ? t('tree.under', { reference: parent.reference }) : ''
    },
    /** What the window reads of a tree: how many rows it could show, and every one of them. */
    window: tree
      ? { everyRow: () => groups.value?.items ?? live()?.scope ?? [], population: tree.population }
      : {},
  }
}
