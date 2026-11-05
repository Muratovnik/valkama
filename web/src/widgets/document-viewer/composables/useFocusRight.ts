/**
 * Whether the document may move focus now. Every move that takes focus from wherever it stands
 * asks here, so the answer is one answer.
 *
 * It may in answer to what the person did: an opening they began, a step they took inside the
 * document. That right is given as the read starts and lasts until the read has landed, or until
 * they move focus themselves, back to the link included. A read the window's return began is
 * given none, so it never takes focus, whatever it comes to: a person typing in the card lost
 * the letters that followed when a refused file turned readable while they were away.
 *
 * A move is theirs when focus changes after a key or a press since the right was given, and is
 * not one of the document's own, which go through `take`. The overlay's own move, onto a
 * drawer as it opens, follows no such input, so it does not count, and the overlay need not
 * know of this. A key that moves nothing leaves the right where it was.
 */
import { useEventListener } from '@vueuse/core'

export function useFocusRight() {
  let held = false
  let touched = false
  let moving = false

  const touch = () => {
    touched = true
  }
  const focusChanged = () => {
    if (touched && !moving) held = false
  }
  for (const kind of ['keydown', 'pointerdown'] as const)
    useEventListener(document, kind, touch, { capture: true, passive: true })
  for (const kind of ['focusin', 'focusout'] as const)
    useEventListener(document, kind, focusChanged, { capture: true })

  return {
    /** The person asked for a document or a place in one; what they pressed is behind them. */
    give() {
      held = true
      touched = false
    },
    /** The read has landed, or there is nothing left for it to land on. */
    spend() {
      held = false
    },
    /** Makes the move if the right still stands; the right outlasts it, for the next one. */
    take(move: () => void) {
      if (!held) return
      moving = true
      try {
        move()
      } finally {
        moving = false
      }
    },
  }
}
