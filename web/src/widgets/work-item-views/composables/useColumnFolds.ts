/**
 * Which of a board's columns stand folded to a strip, per planning space.
 *
 * Only a column of work put off folds, and it starts folded: what is put off is not the
 * work of the day, and its column took a whole track of the board. The strip keeps its
 * name and its count, and a press opens it. Under a filter a column nobody folded opens
 * while it holds a match, because a search that found deferred work should show it. Only
 * what the reader chose against that is kept (`useFoldChoices`), and it survives a reload.
 */
import type { WorkflowState } from '@/shared/api/planningModel.ts'
import { useFoldChoices } from '@/shared/lib/useFoldChoices.ts'

const STORAGE_KEY = 'valkama-board-columns'

/** The categories whose column folds. */
const FOLDING: ReadonlySet<string> = new Set(['deferred'])

const foldable = (state: WorkflowState): boolean => FOLDING.has(state.category)

export function useColumnFolds(input: {
  /** A queue or search filter narrows the board. */
  filtered: () => boolean
  /** How many tiles the column of a state draws. */
  holds: (state: WorkflowState) => number
  space: () => string
}) {
  const { choices, choose } = useFoldChoices(STORAGE_KEY, input.space)

  /** What the rule makes the column: folded, or under a filter folded while it holds nothing. */
  const ruled = (state: WorkflowState): boolean => !input.filtered() || input.holds(state) === 0

  function folded(state: WorkflowState): boolean {
    return foldable(state) ? (choices.value[state.state_id] ?? ruled(state)) : false
  }

  /** Fold or open a column; outside a filter, a choice the rule would make is forgotten. */
  function toggle(state: WorkflowState) {
    if (!foldable(state)) return
    choose(state.state_id, !folded(state), input.filtered() ? undefined : true)
  }

  return { foldable, folded, toggle }
}
