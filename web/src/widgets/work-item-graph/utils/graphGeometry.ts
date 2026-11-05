/** Shared card bounds keep layout, routing, and the Vue Flow wrapper in sync. */

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

/** What an agent's session behind an item is doing now: the read model's contract, as it is. */
export type { LiveWork } from '@/shared/api/liveWorkModel.ts'

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
  /** Unfolding it would draw something; without that it stays folded and offers no fold. */
  foldable: boolean
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
 * A frame's header, the same one folded or open and at every zoom: folding
 * changes what stands under it and nothing in it, and the layout's room for it
 * is what is drawn. It holds the reference line, three lines of title, the counts,
 * what a fold hides and the progress edge, and it is tall enough to hit from far
 * off: with the air round it its target (`GraphFrame`) stays 24px on a screen
 * down to a zoom of 0.104.
 */
export const FRAME_HEADER = 160
/** The air between an open frame's edge and the work inside it. */
export const FRAME_PADDING = 16
/** A folded frame is its header alone, a little wider than a card so its counts fit. */
export const FOLDED_WIDTH = 288

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
