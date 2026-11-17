/**
 * The way from an anchor to the hint it raised: where a pointer heading for the hint passes. A
 * hint the pointer can enter stands beside its anchor, often past other elements with hints of
 * their own, as a rail row's hint stands past the row's cut name and its pin: whatever the
 * pointer crossed on its way took over at once, and the hint it was going to was gone before it
 * got there (WCAG 2.2, 1.4.13).
 *
 * The way is the smallest convex region holding the hint's box and a short stroke through the
 * point the pointer left the anchor from, `SLACK` to either side across the way: a pointer inside
 * it is still heading for the hint, one outside it, as one going straight to the next row of a
 * list or along a legend past a hint under its entry, is not.
 */
import type { Box } from '@/shared/ui/hintPlacement.ts'

export interface Point {
  x: number
  y: number
}

/** How far to either side of the point the pointer left from the way starts, in px. */
const SLACK = 4

/** Whether `b` turns left of the line from `origin` through `a`: positive left, negative right. */
const turn = (origin: Point, a: Point, b: Point) =>
  (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)

/** The corners of the convex hull of `points`, each turning the same way (a monotone chain). */
function hull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((one, other) => one.x - other.x || one.y - other.y)
  const chain = (ordered: readonly Point[]) => {
    const kept: Point[] = []
    for (const point of ordered) {
      while (kept.length >= 2) {
        const [before, last] = kept.slice(-2)
        if (!before || !last || turn(before, last, point) > 0) break
        kept.pop()
      }
      kept.push(point)
    }
    kept.pop()
    return kept
  }
  return [...chain(sorted), ...chain([...sorted].reverse())]
}

/** Whether `at` lies on the way from `from`, where the pointer left an anchor, to the hint `box`. */
export function onWayTo(from: Point, box: Box, at: Point): boolean {
  // Across the way: square to the line from the point to the middle of the hint.
  const along = { x: (box.left + box.right) / 2 - from.x, y: (box.top + box.bottom) / 2 - from.y }
  const length = Math.hypot(along.x, along.y) || 1
  const across = { x: (-along.y / length) * SLACK, y: (along.x / length) * SLACK }
  const corners = hull([
    { x: from.x - across.x, y: from.y - across.y },
    { x: from.x + across.x, y: from.y + across.y },
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    { x: box.right, y: box.bottom },
    { x: box.left, y: box.bottom },
  ])
  return corners.every((corner, index) => {
    const next = corners[(index + 1) % corners.length] ?? corner
    return turn(corner, next, at) > 0
  })
}
