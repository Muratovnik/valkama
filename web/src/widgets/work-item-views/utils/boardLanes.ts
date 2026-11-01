/**
 * The board read by epic: one lane per epic, holding its children, and one lane
 * for the work filed under none.
 *
 * Three sets go in because a lane answers three questions. Which lanes there are
 * and what each counts comes from the board's scope — the space, or the chain it
 * is narrowed to — before any queue or search filter, because a lane's counts
 * describe its epic and not the filter. Which tiles a lane draws comes from the
 * filtered items. And an epic is named from the whole space, because a chain can
 * hold an item whose epic is not itself in the chain.
 *
 * An epic is the lane, not a tile in it: its title heads the lane and its state
 * is marked there, and its card is one click away. Drawing it again among its
 * own children would put the same item twice on one screen.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

export type BoardGrouping = 'epic' | 'none'

/** The lane of the work filed under no epic. */
export const NO_EPIC = 'none'

/** Tiles a lane cell draws before it asks to show the rest. */
const CELL_LIMIT = 3

/**
 * How many tiles a lane cell draws unasked. A terminal cell (Done, Cancelled)
 * draws none: its work is finished, so it is counted and offered instead.
 */
export function drawnInCell(state: { is_terminal: boolean }): number {
  return state.is_terminal ? 0 : CELL_LIMIT
}

export interface BoardLane {
  closed: number
  /** The epic heading the lane; null for the work under none. */
  epic: WorkItemBrief | null
  /** The epic's work item id, or `NO_EPIC`. */
  id: string
  /** The tiles the lane draws, in the order the server listed them. */
  items: WorkItemBrief[]
  open: number
}

/** An item that heads a lane: something's parent, or an epic, and nobody's child. */
function headsLane(item: WorkItemBrief): boolean {
  return item.parent_id === null && (item.container || item.kind === 'epic')
}

/**
 * The lanes, in reading order: those with open work first, then those without,
 * each in the order the space lists its epics, and the work under no epic last.
 *
 * Under a filter a lane with nothing to draw is left out, or a search would
 * answer with a column of empty lane headings; without one every epic keeps its
 * lane, an empty one included, so a new epic is visible before it holds work.
 */
export function boardLanes(input: {
  filtered: boolean
  scope: readonly WorkItemBrief[]
  space: readonly WorkItemBrief[]
  visible: readonly WorkItemBrief[]
}): BoardLane[] {
  const order = new Map(input.space.map((item, index) => [item.work_item_id, index]))
  const byId = new Map(input.space.map((item) => [item.work_item_id, item]))
  const lanes = new Map<string, BoardLane>()
  const laneOf = (item: WorkItemBrief): string | null => {
    if (headsLane(item)) return null
    return item.parent_id !== null && byId.has(item.parent_id) ? item.parent_id : NO_EPIC
  }
  const lane = (id: string): BoardLane => {
    let found = lanes.get(id)
    if (found === undefined) {
      found = { id, epic: byId.get(id) ?? null, items: [], open: 0, closed: 0 }
      lanes.set(id, found)
    }
    return found
  }
  for (const item of input.scope) {
    const id = laneOf(item)
    if (id === null) {
      lane(item.work_item_id)
      continue
    }
    const counted = lane(id)
    if (item.state.is_terminal) counted.closed += 1
    else counted.open += 1
  }
  for (const item of input.visible) {
    const id = laneOf(item)
    if (id !== null) lane(id).items.push(item)
  }
  const rank = (entry: BoardLane) =>
    entry.id === NO_EPIC ? Number.POSITIVE_INFINITY : (order.get(entry.id) ?? 0)
  return [...lanes.values()]
    .filter((entry) => !input.filtered || entry.items.length > 0)
    .filter((entry) => entry.id !== NO_EPIC || entry.open + entry.closed > 0)
    .sort(
      (left, right) =>
        Number(left.id === NO_EPIC) - Number(right.id === NO_EPIC) ||
        Number(left.open === 0) - Number(right.open === 0) ||
        rank(left) - rank(right),
    )
}

/** A state a lane holds work in, and how much. */
export interface HeldIn<State> {
  count: number
  state: State
}

/**
 * What a lane holds out of sight on each side of the columns `first` to `last`.
 * Finished work is counted in the lane's heading already, so a terminal state
 * is named only when nothing of the lane is in view.
 */
export function outOfSight<State extends { is_terminal: boolean }>(
  states: readonly State[],
  first: number,
  last: number,
  count: (state: State) => number,
): { left: HeldIn<State>[]; right: HeldIn<State>[] } {
  const seen = states.slice(first, last + 1).some((state) => count(state) > 0)
  const held = (side: readonly State[]) =>
    side
      .map((state) => ({ state, count: count(state) }))
      .filter((entry) => entry.count > 0 && (!entry.state.is_terminal || !seen))
  return { left: held(states.slice(0, first)), right: held(states.slice(last + 1)) }
}
