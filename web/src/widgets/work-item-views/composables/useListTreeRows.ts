/**
 * What the list draws differently as a tree, for each row: the indent and the
 * arrow at its start, the quiet tone of a path row with the count of what
 * matched under it, the parent of a row deeper than the indent goes, and the
 * names a reader hears. A flat list asks the same and is told nothing.
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

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { TreeRow } from '@/shared/lib/treeRows.ts'
import type { ListFocus } from '@/shared/ui/useListKeys.ts'

/** A tree's whole scope before the filter, whether one is in force, and its space. */
interface TreeScope {
  filtered: boolean
  scope: WorkItemBrief[]
  space: string
}

interface ListTreeRows {
  /** What the filter let through. */
  items: () => readonly WorkItemBrief[]
  narrow: () => boolean
  /** The rows' items in the list's order. */
  ordered: () => readonly WorkItemBrief[]
  /** The tree, or null for a flat list; which of the two is read once, as the list is made. */
  tree: () => TreeScope | null
}

export function useListTreeRows({ items, narrow, ordered, tree: live }: ListTreeRows) {
  const { t } = useI18n()
  const matched = computed(() =>
    live()?.filtered ? new Set(items().map((item) => item.work_item_id)) : null,
  )
  const tree = live()
    ? useListTree({
        items: () => live()?.scope ?? [],
        matches: () => matched.value,
        ordered,
        space: () => live()?.space ?? '',
      })
    : null

  const levels = computed(() => (narrow() ? 3 : 5))
  const step = computed(() => (narrow() ? 16 : 24))

  const treeOf = (item: WorkItemBrief) => tree?.rowOf(item)
  const ids = useId()
  const refId = (item: WorkItemBrief) => `${ids}-ref-${item.work_item_id}`
  const nameId = (item: WorkItemBrief) => `${ids}-name-${item.work_item_id}`

  return {
    /** A tree's cells take focus from the keys, out of the Tab order. */
    cellTab: tree ? -1 : undefined,
    /** What a path row is, for a reader: the tone that says it is not read. */
    describedBy: (row: TreeRow<WorkItemBrief>) => (row.context ? t('tree.path') : undefined),
    focus: (tree
      ? {
          kind: 'row',
          tree: { expanded: tree.expanded, parentOf: tree.parentOf, toggle: tree.toggle },
        }
      : { kind: 'opener' }) satisfies ListFocus as ListFocus,
    indentOf: (item: WorkItemBrief) =>
      tree ? Math.min(tree.depthOf(item), levels.value - 1) * step.value : 0,
    isPath: (item: WorkItemBrief) => treeOf(item)?.context === true,
    isTree: tree !== null,
    labelledBy: (item: WorkItemBrief) => `${refId(item)} ${nameId(item)}`,
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
    /** The parent of a row deeper than the indent goes, which the indent no longer shows. */
    underOf(item: WorkItemBrief): string {
      const row = treeOf(item)
      if (!tree || !row || row.depth < levels.value) return ''
      const parent = tree.parentItem(row)
      return parent ? t('tree.under', { reference: parent.reference }) : ''
    },
    /** What the window reads of a tree: how many rows it could show, and every one of them. */
    window: tree ? { everyRow: () => live()?.scope ?? [], population: tree.population } : {},
  }
}
