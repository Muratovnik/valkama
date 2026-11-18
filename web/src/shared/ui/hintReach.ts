/**
 * Whether the pointer reaches what an anchor's hint speaks for, for the hint manager
 * (`hintManager.ts`), where the target the anchor was found from takes the pointer past it
 * (`HintKind.reaches`): a board tile's open target is stretched over the whole tile, and its
 * title's whole words rise over the title alone. The pointer moving within one target brings
 * no new target to find an anchor from, so the last answer is kept with the target it was
 * found on, and a move across the edge of the reach asks again. A layer that picks its anchor by
 * where the pointer stands on it (`data-hint-pick`, `vHintPick`) asks again at every move, since
 * any move on it may stand over another anchor's place.
 */
import type { Point } from '@/shared/ui/hintWay.ts'

/** Whether the point `x`, `y` reaches what `anchor`'s hint speaks for. */
type Reaches = (anchor: HTMLElement, x: number, y: number) => boolean

/** The anchor last asked, the target it was found from, and the answer. */
let last: { anchor: HTMLElement; reached: boolean; reaches: Reaches; target: Element } | null = null

/** Whether the pointer at `at` on `target` reaches `anchor`: anywhere, for a kind that never asks. */
export function reachedAt(
  reaches: Reaches | undefined,
  anchor: HTMLElement,
  target: Element,
  at: Point | null,
): boolean {
  if (!reaches || !at) return true
  last = { anchor, reached: reaches(anchor, at.x, at.y), reaches, target }
  return last.reached
}

/**
 * Whether the pointer moved within `target` onto or off what an anchor found from it reaches, or
 * moved on a layer that picks its anchor by the point.
 */
export function crossesReach(target: Element | null, at: Point): boolean {
  return (
    Boolean(target?.closest('[data-hint-pick]')) ||
    (last?.target === target && last.reaches(last.anchor, at.x, at.y) !== last.reached)
  )
}
