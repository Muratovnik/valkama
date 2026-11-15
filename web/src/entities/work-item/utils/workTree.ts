/**
 * How the tree of work reads a work item: by its id, under its parent, as a
 * container when it is a goal or a stage, and as open until work on it is over.
 *
 * Whether an item holds others and whether it is open are each read here and
 * nowhere else — by the tree of rows (`treeRows`), the board's lanes and the
 * graph's frames — so a read model that comes to say either another way changes
 * these two functions and nothing that stands on them.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { TreeSource } from '@/shared/lib/treeRows.ts'

/**
 * Whether the item holds other work: a goal, or a stage under a parent. It reads the
 * kind alone, so a card that knows only the kind its host named asks it too.
 */
const holdsWork = (item: { readonly kind: string }): boolean =>
  item.kind === 'goal' || item.kind === 'stage'

/**
 * Whether work on the item is still to finish. The record says so itself: an
 * accepted open goal or stage stands in no state, so its state cannot.
 */
const isOpenWork = (item: Pick<WorkItemBrief, 'open'>): boolean => item.open

export const WORK_ITEM_TREE = {
  id: (item: Pick<WorkItemBrief, 'work_item_id'>) => item.work_item_id,
  isContainer: holdsWork,
  isOpen: isOpenWork,
  parentId: (item: Pick<WorkItemBrief, 'parent_id'>) => item.parent_id,
} satisfies TreeSource<WorkItemBrief>
