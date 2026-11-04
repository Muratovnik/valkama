/** Shared card bounds keep layout, routing, and the Vue Flow wrapper in sync. */

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

/**
 * What an agent's session behind an item is doing now, as the server's
 * `live_work` names it: a turn running, a turn finished and waiting for a
 * person, or a session alive by its lease that has said nothing for a day.
 * An item without live work is absent from that map. `quiet_since` is the
 * time of the session's last sign of life.
 */
export type LiveWork = { quiet_since: string; state: 'quiet' } | { state: 'waiting' | 'working' }

/** The frame of the work filed under no epic. */
export const NO_EPIC_FRAME = 'none'

/**
 * A visible work item placed by the layout engine, as a box in the field's own
 * space: every reader measures the box it was given rather than a card size.
 */
export interface PlacedNode extends WorkItemBrief {
  /** The frame that holds it: an epic's id or `NO_EPIC_FRAME`. */
  frameId: string
  height: number
  width: number
  x: number
  y: number
}

/**
 * How the work under a frame stands, by the groups a chain is read in. It
 * counts every item under the frame, open and closed, whatever the field draws
 * or a filter lets through: the counts describe the epic, not the view.
 */
export interface FrameProgress {
  active: number
  /** Queued and backlog. */
  ahead: number
  blocked: number
  done: number
  review: number
  total: number
}

/**
 * An epic, an item that grew children, or the work under none, drawn as a
 * frame round its work — or, folded, as its header alone.
 */
export interface PlacedFrame {
  epic: WorkItemBrief | null
  folded: boolean
  height: number
  /** An epic's or container's `work_item_id`, or `NO_EPIC_FRAME`. */
  id: string
  /** Open and closed work under it, nested frames' included, for live counts. */
  members: readonly string[]
  /** The frame a nested one stands in. */
  parentId: string | null
  progress: FrameProgress
  width: number
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
