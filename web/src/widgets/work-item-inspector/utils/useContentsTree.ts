/**
 * A goal's or a stage's contents as the tree of rows (`treeRows`): its stages and tasks
 * under it by depth, the root's own children at the top, as the chain read in scope
 * `tree` answers them.
 *
 * A member names its parent by reference, and the tree reads things by id, so the
 * parent is found among the members; the root is not one of them, so its children
 * stand at the top. Rows that share a parent keep the order the read gives every list
 * of many items, the queue's.
 *
 * Folding is the tree of rows' own: a container is folded by the rule
 * (`foldedByRule`) where nobody chose, and the reader's choice against it is kept per
 * space under the list's key (`valkama-tree-folds`), so a goal folded in the list is
 * folded here as well.
 */
import { computed } from 'vue'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { ChainMember } from '@/shared/api/planningChainApi.ts'
import { foldedByRule, treeRows } from '@/shared/lib/treeRows.ts'
import type { FoldFacts, TreeSource } from '@/shared/lib/treeRows.ts'
import { useFoldChoices } from '@/shared/lib/useFoldChoices.ts'

const STORAGE_KEY = 'valkama-tree-folds'

export function useContentsTree(members: () => readonly ChainMember[], space: () => string) {
  const { choices, choose } = useFoldChoices(STORAGE_KEY, space)

  const laid = computed(() => {
    const items = members()
    const ids = new Map(items.map((member) => [member.reference, member.work_item_id]))
    const place = new Map(items.map((member, at) => [member.work_item_id, at]))
    const source: TreeSource<ChainMember> = {
      id: (member) => member.work_item_id,
      isContainer: WORK_ITEM_TREE.isContainer,
      isOpen: WORK_ITEM_TREE.isOpen,
      parentId: (member) =>
        member.parent_reference === null ? null : (ids.get(member.parent_reference) ?? null),
    }
    const chosen = choices.value
    const facts = new Map<string, FoldFacts>()
    const tree = treeRows(source, {
      folded: (id, given) => {
        facts.set(id, given)
        return chosen[id] ?? foldedByRule(given)
      },
      items,
      matches: null,
      order: (left, right) =>
        (place.get(left.work_item_id) ?? 0) - (place.get(right.work_item_id) ?? 0),
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
