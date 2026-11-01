/**
 * The board's columns: which order they stand in, and how wide each one is.
 *
 * The order is the workflow's, with one exception the board makes for reading:
 * the terminal states stand last. A workflow may list Blocked after Done, and a
 * board read left to right then hides the one column that asks for attention
 * behind the one that grows forever. Nothing here knows which states exist; it
 * asks only whether a state is terminal.
 *
 * The width answers a scroll problem. Tracks of a fixed floor that overflow the
 * board leave a column cut in half at the right edge, its name and count sliced
 * mid-word, so the board reads as if `Done 948` said `Done 1`. Sized here, the
 * columns that fit fill the visible width exactly, and the next one starts at
 * the edge rather than across it.
 */
import type { WorkflowState } from '@/shared/api/planningModel.ts'

/** The narrowest a column is drawn; at 1440px five of them fit beside the rail. */
export const COLUMN_FLOOR = 208

/** Columns already in workflow order, the terminal ones moved last and kept in that order. */
export function terminalLast<Column extends { state: Pick<WorkflowState, 'is_terminal'> }>(
  columns: readonly Column[],
): Column[] {
  return [...columns].sort(
    (left, right) => Number(left.state.is_terminal) - Number(right.state.is_terminal),
  )
}

/**
 * How wide each of `count` columns is drawn in `available` pixels with `gap`
 * between them: as many whole columns as fit at the floor share the width, and
 * when every column fits they share all of it. Null when nothing was measured.
 */
export function columnWidth(available: number, count: number, gap: number): number | null {
  if (available <= 0 || count < 1) return null
  const fit = Math.max(1, Math.min(count, Math.floor((available + gap) / (COLUMN_FLOOR + gap))))
  return Math.max(COLUMN_FLOOR, (available - gap * (fit - 1)) / fit)
}

/**
 * Which columns a sideways scroll shows, as the first and last index in view: a
 * column is in view when its middle is. `width` and `gap` are what the columns
 * were drawn at; with nothing measured every column counts as in view, so a
 * board that cannot be measured says nothing is off to either side.
 */
export function columnsInView(input: {
  available: number
  count: number
  gap: number
  scrollLeft: number
  width: number | null
}): { first: number; last: number } {
  const { available, count, gap, scrollLeft, width } = input
  if (width === null || available <= 0 || count < 1) return { first: 0, last: count - 1 }
  const step = width + gap
  const middle = (index: number) => index * step + width / 2
  let first = 0
  while (first < count - 1 && middle(first) < scrollLeft) first += 1
  let last = count - 1
  while (last > first && middle(last) > scrollLeft + available) last -= 1
  return { first, last }
}
