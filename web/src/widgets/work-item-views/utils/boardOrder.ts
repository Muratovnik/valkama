/**
 * A move on the board, as the server is asked for it and as the board shows it
 * before the server has answered.
 *
 * The server owns the order: a state's items arrive in it, and a move is sent
 * as the state the item goes to and where it lands among that state's items —
 * `first`, `last`, `before:<reference>` or `after:<reference>`. Drawing the
 * answer only once it came back would leave a dropped tile where it was taken
 * from for the length of a round trip, so the board draws the same move itself
 * first, from the same two facts, and the next read replaces it.
 */
import type { PlanningWorkflow, WorkItemBrief } from '@/shared/api/planningModel.ts'

export interface BoardMove {
  reference: string
  /** The key of the state the item goes to; its own state for a reorder. */
  state: string
  /** Where among that state's items; absent puts it last, as a plain move does. */
  rank?: string
}

/**
 * Where a tile dropped between two others goes: before the one below it, or
 * after the one above it when it landed last. Nothing on either side is the
 * state's own default, last.
 */
export function rankBeside(previous?: string, next?: string): string | undefined {
  if (next !== undefined) return `before:${next}`
  return previous === undefined ? undefined : `after:${previous}`
}

/** Where `rank` puts an item among `items`, all of one state, without it. */
function landing(items: readonly WorkItemBrief[], rank: string | undefined): number {
  if (rank === 'first') return 0
  const [where, anchor] = rank?.split(':') ?? []
  const at = items.findIndex((item) => item.reference === anchor)
  if (at < 0) return items.length
  return where === 'before' ? at : at + 1
}

/**
 * The space's items with one move applied, in the order the server would list
 * them: states in workflow order, each in its own order.
 *
 * An item or state the model does not know leaves the items as they were, so a
 * move that raced a deletion draws nothing rather than something invented.
 */
export function placeLocally(
  items: readonly WorkItemBrief[],
  workflow: PlanningWorkflow,
  move: BoardMove,
): WorkItemBrief[] {
  const item = items.find((candidate) => candidate.reference === move.reference)
  const target = workflow.states.find((state) => state.key === move.state)
  if (item === undefined || target === undefined) return [...items]
  const states = [...workflow.states].sort((left, right) => left.position - right.position)
  const groups = new Map(
    states.map((state) => [
      state.state_id,
      items.filter(
        (candidate) =>
          candidate.state.state_id === state.state_id && candidate.reference !== move.reference,
      ),
    ]),
  )
  const state = {
    state_id: target.state_id,
    key: target.key,
    name: target.name,
    category: target.category,
    is_terminal: target.is_terminal,
  }
  const destination = groups.get(target.state_id) ?? []
  destination.splice(landing(destination, move.rank), 0, { ...item, state })
  return states.flatMap((entry) => groups.get(entry.state_id) ?? [])
}
