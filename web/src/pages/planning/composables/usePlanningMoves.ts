import { computed, shallowRef } from 'vue'
import type { Ref } from 'vue'

import { placeLocally } from '@/widgets/work-item-views/utils/boardOrder.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import { transitionWorkItem } from '@/shared/api/planningApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'

interface MoveOptions {
  /** The space as the store last answered it. */
  model: Ref<PlanningReadModel | null>
  /** Tell the operator, in the server's words, why a move was refused. */
  notice: (message: string) => void
  /** Read the space again; resolves once the read has landed or failed. */
  reload: () => Promise<void>
  /** Why no move can be sent from here at all, or null when one can. */
  unwritable: () => string | null
}

/**
 * Moves on the board: sent one at a time, and drawn before they are answered.
 *
 * A move is the state an item goes to; where it stands there the server's
 * order of work says. Each one is sent with the revision the item was read at,
 * so a drop on an item somebody else has moved since is refused with a conflict
 * instead of undoing their move. Two moves of one item in a row — dropped in one
 * column, then in another — would both carry that same read revision, so they
 * go one after another, and the second carries the revision the first one's
 * answer named. A move to the state the item already stands in sends nothing.
 *
 * Until the space is read again the moves are drawn on top of the last read,
 * which is what keeps a dropped tile where it was dropped. A refusal stops the
 * moves still waiting, because they were aimed at a board the server has just
 * said is not the one it holds; the read that follows draws what it does hold.
 */
export function usePlanningMoves(options: MoveOptions) {
  const pending = shallowRef<BoardMove[]>([])
  /** What the store said about an item after a move, until the next read says it. */
  const answered = new Map<string, { revision: number; state: string | null }>()
  let queue: Promise<void> = Promise.resolve()
  let refused = false

  const model = computed(() => {
    const current = options.model.value
    if (current === null || current.workflow === null || pending.value.length === 0) return current
    let items = current.work_items
    for (const move of pending.value) items = placeLocally(items, current.workflow, move)
    return { ...current, work_items: items }
  })

  async function send(move: BoardMove) {
    if (refused) return
    const item = options.model.value?.work_items.find(
      (candidate) => candidate.reference === move.reference,
    )
    if (item === undefined) return
    const known = answered.get(move.reference)
    const revision = Math.max(item.revision, known?.revision ?? item.revision)
    if ((known ? known.state : (item.state?.key ?? null)) === move.state) return
    try {
      const answer = await transitionWorkItem({
        id: move.reference,
        state: move.state,
        expected_revision: revision,
      })
      answered.set(move.reference, { revision: answer.revision, state: answer.state?.key ?? null })
    } catch (error) {
      refused = true
      options.notice(error instanceof Error ? error.message : String(error))
    }
  }

  /** Draw a move now and send it after the ones already waiting. */
  function place(move: BoardMove) {
    const refusal = options.unwritable()
    if (refusal !== null) {
      options.notice(refusal)
      return
    }
    pending.value = [...pending.value, move]
    queue = queue
      .then(() => send(move))
      .then(async () => {
        if (pending.value.at(-1) !== move) return
        // The last move answered: one read replaces every move drawn so far.
        // A move made while that read was in flight is still drawn and sent.
        await options.reload()
        pending.value = pending.value.slice(pending.value.indexOf(move) + 1)
        refused = false
        if (pending.value.length === 0) answered.clear()
      })
  }

  return { model, place }
}
