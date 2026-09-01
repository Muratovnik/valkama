/**
 * The geometry of the graph: how wide a rank is, how tall a row is, and the two
 * comparisons every part of the layout sorts by.
 *
 * It sits below both the algorithm and the view because both spend it, and
 * leaving it in either made the two import each other.
 */

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

/** One laid-out item: a rank column inside the wired chains, or a grid slot below. */
export interface PlacedNode extends WorkItemBrief {
  isolated: boolean
  x: number
  y: number
}

export const COLUMN_WIDTH = 268
export const ROW_HEIGHT = 104
export const NODE_WIDTH = 220
export const NODE_HEIGHT = 88
/** The unlinked grid wraps into a further column past this many rows. */
export const ISOLATED_ROWS = 12
export const MARGIN = 24
export const SECTION_GAP = 72
/** Left edge (px) of a rank column. */
export const columnX = (level: number) => MARGIN + level * COLUMN_WIDTH
/** Independent chains stack with this gap instead of sharing rows. */
export const COMPONENT_GAP = 48
/** dot caps ordering at 24 iterations; dagre stops after 4 without improvement. */
export const MAX_SWEEPS = 24
export const PATIENCE = 4

/**
 * Siblings of one parent stay together, and within a parent the item number
 * decides. Numbers order the rows rather than ids because a work item id is a
 * UUID: sorting by it would scatter siblings created minutes apart.
 */
export function rowOrder(left: WorkItemBrief, right: WorkItemBrief): number {
  const leftParent = left.parent_id ?? ''
  const rightParent = right.parent_id ?? ''
  if (leftParent !== rightParent) {
    // An item with no parent sorts after every grouped one, so the epics'
    // children read as blocks rather than being split by loose work.
    if (leftParent === '') return 1
    if (rightParent === '') return -1
    return leftParent < rightParent ? -1 : 1
  }
  return left.number - right.number
}
