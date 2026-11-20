/**
 * The goals of the Volumes read as the tree of rows (`useFoldedTree`): each goal at the top, its
 * stages under it to any depth, as the read nests them in `children`.
 *
 * The rows that share a parent stand in the order of the table's sorted column (`useColumnSort`):
 * the rows are sorted together, and each row's place in that order orders it among its own. A
 * row's figures are the read's, never added up here. Folding is every tree's, kept per space, so
 * a goal folded in Work's list is folded here as well.
 */
import { computed } from 'vue'

import type { VolumesGoal } from '@/shared/api/volumesReadApi.ts'
import { useFoldedTree } from '@/shared/lib/useFoldedTree.ts'

/** A row of the tree: the goal's or stage's own row, with the id of the row over it. */
export interface GoalLine {
  goal: VolumesGoal
  parentId: string | null
}

/** Every row of the read, each goal before the stages under it. */
export function goalLines(goals: readonly VolumesGoal[], parentId: string | null = null) {
  const lines: GoalLine[] = []
  for (const goal of goals)
    lines.push({ goal, parentId }, ...goalLines(goal.children, goal.work_item_id))
  return lines
}

export function useGoalTree(options: {
  /** The rows in the order the table is sorted by. */
  sorted: () => readonly GoalLine[]
  /** The space the reader's folds are kept by. */
  space: () => string
}) {
  const place = computed(
    () => new Map(options.sorted().map((line, at) => [line.goal.work_item_id, at])),
  )
  return useFoldedTree<GoalLine>({
    items: options.sorted,
    order: () => {
      const at = place.value
      return (left, right) =>
        (at.get(left.goal.work_item_id) ?? 0) - (at.get(right.goal.work_item_id) ?? 0)
    },
    source: {
      id: (line) => line.goal.work_item_id,
      isContainer: () => true,
      isOpen: (line) => line.goal.open,
      parentId: (line) => line.parentId,
    },
    space: options.space,
  })
}
