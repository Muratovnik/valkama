/**
 * A move on the board, as the server is asked for it and as the board shows it
 * before the server has answered.
 *
 * The server computes the order of work, and a state's items arrive in it;
 * nothing places an item by hand. A move is sent as the state the item goes to
 * and nothing else. Drawing the answer only once it came back would leave a
 * dropped tile where it was taken from for the length of a round trip, so the
 * board draws the tile last in its new state first, and the next read puts it
 * where the order of work does. The board does not repeat that order: it has
 * one form, the server's.
 */
import type { PlanningWorkflow, WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'

export interface BoardMove {
  reference: string
  /** The key of the state the item goes to, which is another than its own. */
  state: string
}

/**
 * The space's items with one move applied, as the board draws them until the
 * next read: states in workflow order, each in the order it was read, the moved
 * item last in its new one, then the accepted open goals and stages, which stand
 * in no state the workflow lists and keep their place there.
 *
 * An item or state the model does not know leaves the items as they were, so a
 * move that raced a deletion draws nothing rather than something invented.
 */
export function placeLocally<Item extends WorkItemBrief>(
  items: readonly Item[],
  workflow: PlanningWorkflow,
  move: BoardMove,
): Item[] {
  const item = items.find((candidate) => candidate.reference === move.reference)
  const target = workflow.states.find((state) => state.key === move.state)
  if (item === undefined || target === undefined) return [...items]
  const states = [...workflow.states].sort((left, right) => left.position - right.position)
  const groups = new Map(
    states.map((state) => [
      state.state_id,
      items.filter(
        (candidate) =>
          candidate.state?.state_id === state.state_id && candidate.reference !== move.reference,
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
  // A move into a finishing state closes the item, as the server will say it did.
  destination.push({ ...item, state, open: !target.is_terminal })
  const derived = items.filter((candidate) => candidate.state === null)
  return [...states.flatMap((entry) => groups.get(entry.state_id) ?? []), ...derived]
}

/**
 * Whether a state's tiles stand in the order they closed rather than in an
 * order of work: the completed state. Nothing there is still planned, and what
 * a reader looks for in it is what just finished, so the newest close leads.
 * A tile dropped there from another column is
 * still moved there; it lands on top.
 */
export function ordersByClosing(state: Pick<WorkflowState, 'category'> | null): boolean {
  return state?.category === 'completed'
}

/** When an item closed, in ms; an item with no closing time yet has only just closed. */
function closedAt(item: WorkItemBrief): number {
  const at = item.closed_at ? Date.parse(item.closed_at) : Number.NaN
  return Number.isNaN(at) ? Infinity : at
}

/**
 * The items as the board draws them: those of the completed state newest
 * closed first, ties to the higher number, and every other item where it was,
 * in the order of work the server listed. A tile the board has just moved
 * there itself carries no closing time yet, so it leads until the server's
 * answer says when.
 */
export function newestClosedFirst(items: readonly WorkItemBrief[]): WorkItemBrief[] {
  const closed = items
    .filter((item) => ordersByClosing(item.state))
    .sort((left, right) => closedAt(right) - closedAt(left) || right.number - left.number)
  let next = 0
  return items.map((item) => (ordersByClosing(item.state) ? closed[next++] : item))
}
