/**
 * How a tree of rows reads a work item (`treeRows`): by its id, under its
 * parent, as a container when it holds others, and as open until its state is
 * a terminal one.
 *
 * Whether an item holds others and whether it is open are each read here and
 * nowhere else in a tree, so a read model that comes to say either another way
 * changes these two functions and no tree that stands on them.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import type { TreeSource } from '@/shared/lib/treeRows.ts'

/** Whether the item holds other work: a goal or a stage. */
const holdsWork = (item: WorkItemBrief): boolean => item.container

/** Whether the item is still open: its state is not a terminal one. */
const isOpenWork = (item: WorkItemBrief): boolean => !item.state.is_terminal

export const WORK_ITEM_TREE: TreeSource<WorkItemBrief> = {
  id: (item) => item.work_item_id,
  isContainer: holdsWork,
  isOpen: isOpenWork,
  parentId: (item) => item.parent_id,
}
