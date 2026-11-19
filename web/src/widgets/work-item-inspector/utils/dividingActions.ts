import type { DividingAction } from '@/widgets/work-item-inspector/utils/useInspectorClosing.ts'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { WorkItem } from '@/shared/api/planningModel.ts'

/** A dividing action the card's «…» menu offers, and the words it is offered in. */
export interface DividingEntry {
  action: DividingAction
  /** The message key of its label. */
  label: string
}

const LABELS = 'workItem.dividing.action'

/**
 * What the card's «…» menu offers to change what the item is part of: only what the item's place
 * allows, as the server would take it, so nothing it offers is refused for what the card already
 * knows. Nothing for closed work.
 *
 * - A task outside review, where the owner checks its conditions: «Split off a part…» while a
 *   condition is still open to take, and «Turn into a stage» under a goal or stage or «Turn
 *   into a goal» at the top level, the word its place gives.
 * - A goal or a stage with nothing under it, closed work included: «Return to a task». The
 *   card's read of the work under it says so; until that read answers it is not offered.
 * - Work under a goal or a stage: «Move out of the goal…».
 */
export function dividingActions(item: WorkItem, chain: WorkItemChain | null): DividingEntry[] {
  if (!item.open) return []
  const entries: DividingEntry[] = []
  const placed = item.parent_id !== null
  if (WORK_ITEM_TREE.isContainer(item)) {
    const root = chain?.root.work_item_id === item.work_item_id ? chain.root : null
    if (root && !root.has_children) entries.push({ action: 'to-task', label: `${LABELS}.toTask` })
  } else if (item.state?.category !== 'review') {
    if (item.checklist.some((step) => !step.done))
      entries.push({ action: 'split', label: `${LABELS}.split` })
    entries.push({ action: 'convert', label: `${LABELS}.${placed ? 'toStage' : 'toGoal'}` })
  }
  if (placed) entries.push({ action: 'move-out', label: `${LABELS}.moveOut` })
  return entries
}
