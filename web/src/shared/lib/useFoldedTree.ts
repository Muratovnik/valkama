/**
 * A tree of rows (`treeRows`) with nothing filtered, folded the way every tree is: a container is
 * folded by the rule (`foldedByRule`) where nobody chose, and the reader's choice against it is
 * kept per space under the tree's key (`valkama-tree-folds`), so a goal folded in one tree is
 * folded in every other. What it gives is what the tree's keys read (`useListKeys`): the rows,
 * a row's place, its parent and whether it is open, and the fold of one row.
 */
import { computed } from 'vue'

import { foldedByRule, treeRows } from '@/shared/lib/treeRows.ts'
import type { FoldFacts, TreeSource } from '@/shared/lib/treeRows.ts'
import { useFoldChoices } from '@/shared/lib/useFoldChoices.ts'

const STORAGE_KEY = 'valkama-tree-folds'

export function useFoldedTree<Item>(options: {
  source: TreeSource<Item>
  items: () => readonly Item[]
  /** The order of the rows that share a parent. */
  order: () => (left: Item, right: Item) => number
  /** The space the reader's folds are kept by. */
  space: () => string
}) {
  const { choices, choose } = useFoldChoices(STORAGE_KEY, options.space)

  const laid = computed(() => {
    const chosen = choices.value
    const facts = new Map<string, FoldFacts>()
    const tree = treeRows(options.source, {
      folded: (id, given) => {
        facts.set(id, given)
        return chosen[id] ?? foldedByRule(given)
      },
      items: options.items(),
      matches: null,
      order: options.order(),
    })
    return { facts, tree }
  })

  const rows = computed(() => laid.value.tree.rows)
  const rowOf = computed(() => new Map(rows.value.map((row) => [row.id, row])))
  const placeOf = computed(() => new Map(rows.value.map((row, at) => [row.id, at])))

  /** Fold an open row or open a folded one; a choice that comes back to the rule is forgotten. */
  function toggle(id: string) {
    const row = rowOf.value.get(id)
    const given = laid.value.facts.get(id)
    if (!row || row.expanded === null || !given) return
    choose(id, row.expanded, foldedByRule(given))
  }

  return {
    expanded: (id: string) => rowOf.value.get(id)?.expanded ?? null,
    parentOf: (id: string) => laid.value.tree.parentOf(id),
    placeOf: (id: string) => placeOf.value.get(id) ?? -1,
    rows,
    toggle,
  }
}
