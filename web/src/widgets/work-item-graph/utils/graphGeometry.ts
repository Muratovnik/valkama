/** Shared card bounds keep layout, routing, and the Vue Flow wrapper in sync. */

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

/** A visible work item placed by the layout engine. */
export interface PlacedNode extends WorkItemBrief {
  isolated: boolean
  x: number
  y: number
}

export const NODE_WIDTH = 264
export const NODE_HEIGHT = 112
export const MARGIN = 24

/**
 * The field's Vue Flow store. The canvas and the camera controls beside it are
 * not parent and child, so the controls find the field's camera by this id.
 */
export const GRAPH_FLOW_ID = 'valkama-work-graph'

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
