/**
 * A goal's or a stage's contents as the tree of rows (`useFoldedTree`): its stages and tasks
 * under it by depth, the root's own children at the top, as the chain read in scope
 * `tree` answers them.
 *
 * A member names its parent by reference, and the tree reads things by id, so the
 * parent is found among the members; the root is not one of them, so its children
 * stand at the top. Rows that share a parent keep the order the read gives every list
 * of many items, the queue's. Folding is every tree's, kept per space, so a goal folded
 * in the list is folded here as well.
 */
import { computed } from 'vue'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { ChainMember } from '@/shared/api/planningChainApi.ts'
import { useFoldedTree } from '@/shared/lib/useFoldedTree.ts'

export function useContentsTree(members: () => readonly ChainMember[], space: () => string) {
  const ids = computed(
    () => new Map(members().map((member) => [member.reference, member.work_item_id])),
  )
  const place = computed(() => new Map(members().map((member, at) => [member.work_item_id, at])))
  return useFoldedTree<ChainMember>({
    items: members,
    order: () => {
      const at = place.value
      return (left, right) => (at.get(left.work_item_id) ?? 0) - (at.get(right.work_item_id) ?? 0)
    },
    source: {
      id: (member) => member.work_item_id,
      isContainer: WORK_ITEM_TREE.isContainer,
      isOpen: WORK_ITEM_TREE.isOpen,
      parentId: (member) =>
        member.parent_reference === null ? null : (ids.value.get(member.parent_reference) ?? null),
    },
    space,
  })
}
