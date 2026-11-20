/**
 * The list grouped by goal: the space's work as a tree of rows (`treeRows`),
 * a goal at the top, its stages and tasks under it by depth. Grouped by project it
 * is a tree of one level, the groups' rows and the cards under them (`listGroups`):
 * the same rows, folds and keys, read by another source.
 *
 * The tree lays out the whole scope, filtered or not, so a filter shows what
 * it let through with the path to it. Rows that share a parent stand in the
 * list's order, so a sort orders the rows inside each container.
 *
 * Where nobody chose, a goal or a stage is folded by the rule
 * (`foldedByRule`), and the reader's choice against it is kept per space
 * (`useFoldChoices`, `valkama-tree-folds`), apart from the board's lanes and
 * the graph's frames, whose rules differ.
 */
import { computed } from 'vue'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { foldedByRule, treeRows } from '@/shared/lib/treeRows.ts'
import type { FoldFacts, TreeRow, TreeSource } from '@/shared/lib/treeRows.ts'
import { useFoldChoices } from '@/shared/lib/useFoldChoices.ts'

const STORAGE_KEY = 'valkama-tree-folds'

interface ListTree {
  /** The whole scope, before the filter. */
  items: () => readonly WorkItemBrief[]
  /** What the filter let through; null where nothing is filtered. */
  matches: () => ReadonlySet<string> | null
  /** The scope in the list's order, which orders the rows beside each other. */
  ordered: () => readonly WorkItemBrief[]
  /** How the tree reads its things; the tree of work unless it says. */
  source?: () => TreeSource<WorkItemBrief> | undefined
  space: () => string
}

export function useListTree({ items, matches, ordered, space, source }: ListTree) {
  const read = () => source?.() ?? WORK_ITEM_TREE
  const { choices, choose } = useFoldChoices(STORAGE_KEY, space)

  /** The rows, with the facts each container was folded by. */
  const laid = computed(() => {
    const rank = new Map(ordered().map((item, at) => [item.work_item_id, at]))
    const chosen = choices.value
    const seen = new Map<string, FoldFacts>()
    const tree = treeRows(read(), {
      folded: (id, given) => {
        seen.set(id, given)
        return chosen[id] ?? foldedByRule(given)
      },
      items: items(),
      matches: matches(),
      // A group's row has no place in the list's order and stands after the rows that do.
      order: (left, right) =>
        (rank.get(left.work_item_id) ?? rank.size) - (rank.get(right.work_item_id) ?? rank.size),
    })
    return { facts: seen, tree }
  })
  const layout = computed(() => laid.value.tree)

  const rowOf = computed(() => new Map(layout.value.rows.map((row) => [row.id, row])))
  const byId = computed(() => new Map(items().map((item) => [item.work_item_id, item])))

  /**
   * How deep each thing of the scope stands, shown or not: read from the tree
   * with nothing folded, so a fold does not read it again, nor what stands on it.
   */
  const depths = computed(() => {
    const whole = treeRows(read(), {
      folded: () => false,
      items: items(),
      matches: null,
      order: () => 0,
    })
    return new Map(whole.rows.map((row) => [row.id, row.depth]))
  })
  /** The depth of the deepest thing of the scope, shown or folded away. */
  const deepest = computed(() => {
    let most = 0
    for (const depth of depths.value.values()) most = Math.max(most, depth)
    return most
  })

  /**
   * Fold an open row or open a folded one. Outside a filter, a choice that
   * matches the rule is forgotten, so the row follows its work again.
   */
  function toggle(id: string) {
    const row = rowOf.value.get(id)
    const given = laid.value.facts.get(id)
    if (!row || row.expanded === null || !given) return
    choose(id, row.expanded, given.filtered ? undefined : foldedByRule(given))
  }

  return {
    /** A thing's depth in the tree, a row folded away included. */
    depthOf: (item: WorkItemBrief) => depths.value.get(item.work_item_id) ?? 0,
    deepest: () => deepest.value,
    expanded: (id: string) => rowOf.value.get(id)?.expanded ?? null,
    /** A row's parent, as the item it is. */
    parentItem: (row: TreeRow<WorkItemBrief>) =>
      row.parentId === null ? undefined : byId.value.get(row.parentId),
    parentOf: (id: string) => layout.value.parentOf(id),
    population: () => layout.value.population,
    rowOf: (item: WorkItemBrief) => rowOf.value.get(item.work_item_id),
    rows: computed(() => layout.value.rows.map((row) => row.item)),
    toggle,
  }
}
