/**
 * Where the keyboard goes next on the field.
 *
 * The field is one Tab stop; the arrows walk it. A drawing has no rows or
 * columns of its own — the layout packs chains of different lengths side by
 * side — so an arrow goes to the nearest target in its direction, measured from
 * centre to centre of each target's box, and a step sideways costs twice a step
 * ahead, so the walk keeps to the line it is on before it turns. Home and End go
 * to the first and the last target as the field is read: top to bottom, then
 * left to right.
 *
 * A target is one button with one action: a card, or one of the two in a
 * frame's header — fold or open on its left, and the epic itself across the
 * rest. The work under none has only the first: there is no epic to open.
 */

import { FRAME_HEADER } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedFrame, PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

export type GraphWalkKey = 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'End' | 'Home'

/** A box in the field's own space. */
export interface Box {
  height: number
  width: number
  x: number
  y: number
}

/** One button the keyboard can stand on, and the box it takes on the field. */
export interface WalkTarget extends Box {
  /** The frame it stands in, or the frame whose header it is. */
  frameId: string
  /** A card's `work_item_id`, or a header's `frameTarget` or `foldTarget`. */
  id: string
}

/** The width of a header's fold or open button: a pointer's target. */
const FOLD_TARGET_WIDTH = 44

/** The header button that folds or opens frame `frameId`. */
export const foldTarget = (frameId: string) => `frame:${frameId}:fold`
/** The header button that opens frame `frameId`'s epic. */
export const frameTarget = (frameId: string) => `frame:${frameId}`

const DIRECTIONS: Record<string, { x: number; y: number }> = {
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
}

/** A sideways step weighs this many steps ahead. */
const SIDEWAYS = 2

export function isGraphWalkKey(key: string): key is GraphWalkKey {
  return key in DIRECTIONS || key === 'Home' || key === 'End'
}

/** A frame's header: all of it when folded, its top row when open. */
export function headerBox(frame: PlacedFrame): Box {
  const { x, y, width } = frame
  return { x, y, width, height: frame.folded ? frame.height : FRAME_HEADER }
}

/** Every target on a laid-out field: its cards and the buttons of each frame's header. */
export function walkTargets(graph: {
  frames: readonly PlacedFrame[]
  nodes: readonly PlacedNode[]
}): WalkTarget[] {
  const cards = graph.nodes.map(({ work_item_id, frameId, x, y, width, height }) => ({
    id: work_item_id,
    frameId,
    x,
    y,
    width,
    height,
  }))
  const headers = graph.frames.flatMap((frame) => {
    const header = headerBox(frame)
    const fold = {
      ...header,
      id: foldTarget(frame.id),
      frameId: frame.id,
      width: FOLD_TARGET_WIDTH,
    }
    if (frame.epic === null) return [fold]
    const rest = header.width - FOLD_TARGET_WIDTH
    const open = { ...header, id: frameTarget(frame.id), frameId: frame.id }
    return [fold, { ...open, x: header.x + FOLD_TARGET_WIDTH, width: rest }]
  })
  return [...headers, ...cards]
}

/** The field as it is read: top to bottom, then left to right. */
export function readingOrder(left: Box, right: Box): number {
  return left.y - right.y || left.x - right.x
}

/** The target a key moves to from `fromId`, or null when there is none that way. */
export function graphWalk(
  targets: readonly WalkTarget[],
  fromId: string,
  key: GraphWalkKey,
): string | null {
  if (key === 'Home' || key === 'End') {
    const ordered = [...targets].sort(readingOrder)
    return (key === 'Home' ? ordered[0] : ordered.at(-1))?.id ?? null
  }
  const from = targets.find((target) => target.id === fromId)
  if (!from) return null
  const direction = DIRECTIONS[key]
  const start = nodeCentre(from)
  let best: { id: string; score: number } | null = null
  for (const target of targets) {
    if (target === from) continue
    const centre = nodeCentre(target)
    const dx = centre.x - start.x
    const dy = centre.y - start.y
    const ahead = dx * direction.x + dy * direction.y
    // Half a pixel of layout noise is not a step.
    if (ahead <= 0.5) continue
    const sideways = Math.abs(dx * direction.y) + Math.abs(dy * direction.x)
    const score = ahead + SIDEWAYS * sideways
    if (best === null || score < best.score) best = { id: target.id, score }
  }
  return best?.id ?? null
}

/** The centre of a box, in the field's own space. */
export function nodeCentre(box: Box): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}
