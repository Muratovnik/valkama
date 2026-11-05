/**
 * A laid-out field, frames and lines included, for drawing a field before the
 * layout produces one. Built from the broad space, so its cards and counts are
 * the ones the layout's own tests use.
 */
import {
  FOLDED_WIDTH,
  FRAME_HEADER,
  FRAME_PADDING,
  NO_EPIC_FRAME,
  NODE_HEIGHT,
  NODE_WIDTH,
} from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { FrameProgress, PlacedFrame } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { GraphLayout } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { broadSpace } from './graphSpaces.ts'

/** How the work in `items` stands, counted the way a frame's header counts it. */
function progressOf(items: readonly WorkItemBrief[]): FrameProgress {
  const count = (categories: readonly string[]) =>
    items.filter((item) => !item.state.is_terminal && categories.includes(item.state.category))
      .length
  return {
    done: items.filter((item) => item.state.is_terminal).length,
    review: count(['review']),
    active: count(['active']),
    blocked: count(['blocked']),
    ahead: count(['queued', 'backlog']),
    total: items.length,
  }
}

function frame(
  epic: WorkItemBrief | null,
  members: WorkItemBrief[],
  box: Pick<PlacedFrame, 'folded' | 'height' | 'width' | 'x' | 'y'>,
): PlacedFrame {
  return {
    id: epic?.work_item_id ?? NO_EPIC_FRAME,
    epic,
    parentId: null,
    foldable: true,
    ...box,
    progress: progressOf(members),
    members: members.map((item) => item.work_item_id),
  }
}

/**
 * A laid-out field to draw before the layout produces one: the epic with the
 * long title open round its two open cards, the largest epic and the work under
 * none folded, a line inside the open frame and one folded onto the largest
 * epic's frame, which stands for two links, all as the layout sizes them.
 */
export function placedSample(): GraphLayout {
  const { epics, model } = broadSpace()
  const largest = epics[0]
  const long = epics[5]
  const under = (epic: WorkItemBrief) =>
    model.work_items.filter((item) => item.parent_id === epic.work_item_id)
  const loose = model.work_items.filter((item) => item.parent_id === null && !item.container)
  const cards = under(long).filter((item) => !item.state.is_terminal)
  const targets = under(largest).filter((item) => !item.state.is_terminal)
  const [first, second] = cards
  /** Where the open frame's cards stand, and how tall the frame is round them. */
  const cardY = FRAME_HEADER + FRAME_PADDING
  const cardMiddle = cardY + NODE_HEIGHT / 2
  const openHeight = cardY + NODE_HEIGHT + FRAME_PADDING
  const folded = { folded: true, x: 680, width: FOLDED_WIDTH, height: FRAME_HEADER }
  return {
    frames: [
      frame(long, under(long), { folded: false, x: 0, y: 0, width: 600, height: openHeight }),
      frame(largest, under(largest), { ...folded, y: 0 }),
      frame(null, loose, { ...folded, y: FRAME_HEADER + 56 }),
    ],
    nodes: [first, second].map((item, index) => ({
      ...item,
      x: FRAME_PADDING + index * 304,
      y: cardY,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      frameId: long.work_item_id,
    })),
    edges: [
      {
        id: `${first.work_item_id}>${second.work_item_id}`,
        source: first.work_item_id,
        target: second.work_item_id,
        kind: 'blocks',
        links: [{ from: first.work_item_id, to: second.work_item_id }],
        points: [
          { x: 280, y: cardMiddle },
          { x: 320, y: cardMiddle },
        ],
      },
      {
        id: `${second.work_item_id}>${largest.work_item_id}`,
        source: second.work_item_id,
        target: largest.work_item_id,
        kind: 'discovered-from',
        links: targets
          .slice(0, 2)
          .map((target) => ({ from: second.work_item_id, to: target.work_item_id })),
        points: [
          { x: 584, y: cardMiddle },
          { x: 632, y: cardMiddle },
          { x: 632, y: FRAME_HEADER / 2 },
          { x: 680, y: FRAME_HEADER / 2 },
        ],
      },
    ],
    width: 968,
    height: openHeight,
  }
}
