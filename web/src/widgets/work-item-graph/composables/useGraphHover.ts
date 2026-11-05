/**
 * When the pointer's card takes over the field: hover intent between Vue Flow's
 * enter and leave events and the focus they light.
 *
 * Passed through as they came, every move from one card to the next lit the
 * whole field for the gap between them — the leave of the first cleared the
 * lineage before the second's enter lit another — and a sweep across the field
 * lit every card it passed. So a card takes over only once the pointer has
 * stayed on it a moment, and the card that is lit keeps the field a moment after
 * the pointer has left it: a move to the next card goes straight from one
 * lineage to the other, and a move out to empty ground brings the field back.
 *
 * Only timing lives here. Which card is lit is the reducer's (`graphFocus`), read
 * through `hovered`, so there is no second copy of it to fall out of step; the
 * keyboard's focus never passes through here and lights at once.
 */
import { useTimeoutFn } from '@vueuse/core'

import type { GraphFocusEvent } from '@/widgets/work-item-graph/utils/graphFocus.ts'

/**
 * How long the pointer stays on a card before its lineage takes over. A card is
 * about 110px tall at full size, so a sweep faster than about 900px/s crosses one
 * in less, and lights nothing on the way; resting on a card is far longer.
 */
export const GRAPH_HOVER_TAKE_MS = 120

/**
 * How long a lit card keeps the field after the pointer leaves it. The gap
 * between neighbouring cards is about 48px at full size, which an unhurried
 * move of 300px/s crosses in 160ms; leaving for empty ground restores the field
 * after this, which still reads as an answer to the move.
 */
export const GRAPH_HOVER_HOLD_MS = 200

interface GraphHoverInput {
  /** Whether an id is a card drawn now; a frame is ground and lights nothing. */
  accepts: (id: string) => boolean
  /** Hand a focus event to the field. */
  apply: (event: GraphFocusEvent) => void
  /** The card the hover lights now, as the field holds it. */
  hovered: () => string | null
}

export function useGraphHover({ apply, accepts, hovered }: GraphHoverInput) {
  /** The card under the pointer now, whether or not it has taken over yet. */
  let under: string | null = null

  const take = useTimeoutFn(
    () => {
      if (under !== null && accepts(under)) apply({ type: 'pointer-enter', id: under })
    },
    GRAPH_HOVER_TAKE_MS,
    { immediate: false },
  )
  const drop = useTimeoutFn(
    () => {
      const lit = hovered()
      if (lit !== null) apply({ type: 'pointer-leave', id: lit })
    },
    GRAPH_HOVER_HOLD_MS,
    { immediate: false },
  )

  /** Bring the timers in line with where the pointer is now. */
  function settle() {
    take.stop()
    const lit = hovered()
    if (under === lit) {
      drop.stop()
    } else if (under !== null) {
      // The lit card keeps the field until this one takes over.
      drop.stop()
      take.start()
    } else if (lit !== null && !drop.isPending.value) {
      drop.start()
    }
  }

  return {
    enter(id: string) {
      if (!accepts(id)) return
      under = id
      settle()
    },
    /** A leave for a card the pointer is no longer on is stale and changes nothing. */
    leave(id: string) {
      if (under !== id) return
      under = null
      settle()
    },
    /** The pointer left the field itself. */
    leaveField() {
      under = null
      settle()
    },
  }
}
