/** Shared card bounds keep layout, routing, and the Vue Flow wrapper in sync. */

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

/** What an agent's session behind an item is doing now: the read model's contract, as it is. */
export type { LiveWork } from '@/shared/api/liveWorkModel.ts'

/** The frame of the work filed under no goal. */
export const NO_PARENT_FRAME = 'none'

/**
 * The frame of a chain's work whose parent the chain does not hold: work found
 * on the way, filed under another goal or under none. It is not «no goal», which
 * would say the wrong thing about work that has one elsewhere.
 */
export const FOUND_FRAME = 'found'

/** The space another space's work stands in: its key and its name. */
export type FrameSpace = NonNullable<WorkItemBrief['other_space']>

/** The frame of another space's work, by that space's key; no goal's id starts so. */
export const spaceFrameId = (key: string) => `space:${key}`

/**
 * A visible work item placed by the layout engine, as a box in the field's own
 * space: every reader measures the box it was given rather than a card size.
 */
export interface PlacedNode extends WorkItemBrief {
  /**
   * The frame that holds it: a goal's id, `NO_PARENT_FRAME`, a chain's `FOUND_FRAME` or
   * another space's (`spaceFrameId`).
   */
  frameId: string
  height: number
  width: number
  x: number
  y: number
}

/**
 * How the work under a frame stands, by the groups a chain is read in. It
 * counts every item under the frame, open and closed, whatever the field draws
 * or a filter lets through: the counts describe the goal, not the view.
 */
export interface FrameProgress {
  active: number
  /** Ready, untriaged and deferred. */
  ahead: number
  blocked: number
  done: number
  review: number
  total: number
}

/**
 * A goal, an item that grew children, or the work under none, drawn as a
 * frame round its work — or, folded, as its header alone.
 */
export interface PlacedFrame {
  /** Unfolding it would draw something; without that it stays folded and offers no fold. */
  foldable: boolean
  folded: boolean
  goal: WorkItemBrief | null
  /** How tall its header is: the room the layout left for it, which is what is drawn. */
  header: number
  height: number
  /** A goal's or container's `work_item_id`, `NO_PARENT_FRAME`, `FOUND_FRAME`, or another space's frame. */
  id: string
  /** Open and closed work under it, nested frames' included, for live counts. */
  members: readonly string[]
  /** The frame a nested one stands in. */
  parentId: string | null
  progress: FrameProgress
  width: number
  x: number
  y: number
  /** The other space whose work it holds; null for a frame of this space. */
  space?: FrameSpace | null
}

/** What a frame's header shows, wherever the frame stands. */
export type FrameHead = Pick<
  PlacedFrame,
  'goal' | 'foldable' | 'folded' | 'id' | 'progress' | 'space'
>

export const NODE_WIDTH = 264
export const NODE_HEIGHT = 112
export const MARGIN = 24

/**
 * The room a frame's header is given where nothing has measured it: a layout read in a
 * test, or a document that lays nothing out. On the field each header is as tall as its
 * own lines, measured as the header itself draws them (`GraphFrameHeads`), and this is no
 * less than the tallest of those takes: three lines of title, two of counts and what a
 * fold hides.
 */
export const FRAME_HEADER = 160
/** The air between an open frame's edge and the work inside it. */
export const FRAME_PADDING = 16
/**
 * A folded frame is its header alone, wider than a card so its counts fit, and so its
 * reference line holds the longest state a goal or stage derives, «Ждёт подтверждения»,
 * whole beside a reference of a five-digit number: at 288 that state gave way, and a state
 * waiting for its owner read only once the pointer found it.
 */
export const FOLDED_WIDTH = 312

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
    // An item with no parent sorts after every grouped one, so the goals'
    // children read as blocks rather than being split by loose work.
    if (leftParent === '') return 1
    if (rightParent === '') return -1
    return leftParent < rightParent ? -1 : 1
  }
  return left.number - right.number
}

/**
 * The ends a link is drawn between: the line runs from `source` to `target`, the arrow
 * stands at the target, and the layout ranks the source before it. Every place that turns
 * a stored link into a drawn line asks this, so the layout, the frames, the arrow and the
 * comet agree on one direction.
 *
 * A link is stored the way its relation reads — `from` blocks `to`, `from` was discovered
 * from `to` — and a block is drawn that way, blocker first. A discovery is drawn the other
 * way round, from the work it was found in to the work that grew out of it: drawn as stored,
 * the new task stood before its goal with the arrow on the goal, and the line read as that
 * task done into it. The stored link, and every word that names it, keep the stored order.
 */
export function drawnEnds(link: Pick<PlanningEdge, 'from' | 'kind' | 'to'>): {
  source: string
  target: string
} {
  return link.kind === 'discovered-from'
    ? { source: link.to, target: link.from }
    : { source: link.from, target: link.to }
}
