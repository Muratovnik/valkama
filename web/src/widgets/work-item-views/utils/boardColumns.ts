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
 * the edge rather than across it. A folded column is a strip of its own narrow width,
 * which the open ones leave it before they share the rest.
 */
import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import type { PlanningWorkflow, WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'

/** The narrowest a column is drawn; at 1440px five of them fit beside the rail. */
export const COLUMN_FLOOR = 208

/** How wide a folded column's strip is: its chevron, its name running down it, its count. */
export const FOLDED_COLUMN = 40

/** The categories of a goal or stage nobody has accepted yet. */
const UNACCEPTED: ReadonlySet<string> = new Set(['triage', 'deferred'])

/**
 * Whether an item stands as a tile. A goal or a stage does only while nobody has accepted
 * it, in triage or put off: accepted, it takes its state from the work under it and the
 * board shows it as a lane, and closed it stays in that lane's count rather than in Done.
 */
export function standsAsTile(item: WorkItemBrief): boolean {
  return !WORK_ITEM_TREE.isContainer(item) || UNACCEPTED.has(item.state?.category ?? '')
}

/**
 * The items grouped by state, in workflow order: the board's decision, not the model's. An
 * accepted open goal or stage stands in no state, so it is in no column.
 */
export function byState(
  workflow: PlanningWorkflow,
  items: readonly WorkItemBrief[],
): { items: WorkItemBrief[]; state: WorkflowState }[] {
  return [...workflow.states]
    .sort((left, right) => left.position - right.position)
    .map((state) => ({
      state,
      items: items.filter((item) => item.state?.state_id === state.state_id),
    }))
}

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
 * were drawn at, and the columns at `narrow` are folded strips; with nothing
 * measured every column counts as in view, so a board that cannot be measured
 * says nothing is off to either side.
 */
export function columnsInView(input: {
  available: number
  count: number
  gap: number
  scrollLeft: number
  width: number | null
  narrow?: ReadonlySet<number>
}): { first: number; last: number } {
  const { available, count, gap, narrow, scrollLeft, width } = input
  if (width === null || available <= 0 || count < 1) return { first: 0, last: count - 1 }
  const sizes = Array.from({ length: count }, (_, index) =>
    narrow?.has(index) ? FOLDED_COLUMN : width,
  )
  const starts: number[] = []
  let start = 0
  for (const size of sizes) {
    starts.push(start)
    start += size + gap
  }
  const middle = (index: number) => (starts[index] ?? 0) + (sizes[index] ?? 0) / 2
  let first = 0
  while (first < count - 1 && middle(first) < scrollLeft) first += 1
  let last = count - 1
  while (last > first && middle(last) > scrollLeft + available) last -= 1
  return { first, last }
}
