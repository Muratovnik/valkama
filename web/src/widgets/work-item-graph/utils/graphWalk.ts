/**
 * Where the keyboard goes next on the field.
 *
 * The field is one Tab stop; the arrows walk it. A drawing has no rows or
 * columns of its own — the layout packs chains of different lengths side by
 * side — so an arrow goes to the nearest node in its direction, measured from
 * centre to centre, and a step sideways costs twice a step ahead, so the walk
 * keeps to the line it is on before it turns. Home and End go to the first and
 * the last node as the field is read: top to bottom, then left to right.
 */

import { NODE_HEIGHT, NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

export type GraphWalkKey = 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'End' | 'Home'

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

/** The field as it is read: top to bottom, then left to right. */
export function readingOrder(left: PlacedNode, right: PlacedNode): number {
  return left.y - right.y || left.x - right.x
}

/** The node a key moves to from `fromId`, or null when there is none that way. */
export function graphWalk(
  nodes: readonly PlacedNode[],
  fromId: string,
  key: GraphWalkKey,
): string | null {
  if (key === 'Home' || key === 'End') {
    const ordered = [...nodes].sort(readingOrder)
    return (key === 'Home' ? ordered[0] : ordered.at(-1))?.work_item_id ?? null
  }
  const from = nodes.find((node) => node.work_item_id === fromId)
  if (!from) return null
  const direction = DIRECTIONS[key]
  let best: { id: string; score: number } | null = null
  for (const node of nodes) {
    if (node === from) continue
    const dx = node.x - from.x
    const dy = node.y - from.y
    const ahead = dx * direction.x + dy * direction.y
    // Half a pixel of layout noise is not a step.
    if (ahead <= 0.5) continue
    const sideways = Math.abs(dx * direction.y) + Math.abs(dy * direction.x)
    const score = ahead + SIDEWAYS * sideways
    if (best === null || score < best.score) best = { id: node.work_item_id, score }
  }
  return best?.id ?? null
}

/** The centre of a node, in the field's own space. */
export function nodeCentre(node: PlacedNode): { x: number; y: number } {
  return { x: node.x + NODE_WIDTH / 2, y: node.y + NODE_HEIGHT / 2 }
}
