/**
 * Where a centred dialog stands while what it holds grows or shrinks: centred as it opens, and
 * from the reader's first act in it — a press, a key, a value typed or chosen — at the top it
 * stood at then, so it grows and shrinks at its foot. Centred all along, it grew by half at each
 * edge: a line that appeared under a field, or a refusal at the end of the form, moved the title
 * and every field above it up by half its height, under the hand that had just typed there. It
 * moves up only by what it would otherwise run past the room's foot. What arrives before any act,
 * a picture decoded or a list read as the dialog opens, is under nobody's hand, and the dialog
 * stays centred on it; and it centres again when the window changes size, the reader's own act.
 */
import { computed, ref, watch } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

/**
 * How far below the top of its room a dialog `height` tall stands: centred where nothing holds it
 * yet (`held` null), else where it was held, raised only so far as its foot stays in the room.
 */
export function heldOffset(held: number | null, room: number, height: number): number {
  const wanted = held ?? (room - height) / 2
  return Math.max(0, Math.min(wanted, room - height))
}

const px = (value: string) => Number.parseFloat(value) || 0
/** What the reader does in a dialog, heard before the dialog answers it. */
const ACTS = ['pointerdown', 'keydown', 'input'] as const

/**
 * How far below the top of the host's room `surface` is held while `holds`, for its style to
 * place it there: null until the reader first acts in it, while the host centres it, so the hold
 * takes over where the surface already stood.
 */
export function useHeldTop(surface: () => HTMLElement | null, holds: () => boolean) {
  const offset = ref<number | null>(null)
  const acted = ref(false)

  function measure() {
    const element = surface()
    const host = element?.parentElement
    if (!element || !host || !holds() || !acted.value) return
    const style = getComputedStyle(host)
    const room = host.clientHeight - px(style.paddingTop) - px(style.paddingBottom)
    // Its height as laid out, to the fraction: rounded, the hold moved it by that fraction.
    offset.value = heldOffset(offset.value, room, element.getBoundingClientRect().height)
  }

  function act() {
    if (acted.value) return
    acted.value = true
    measure()
  }

  function recentre() {
    offset.value = null
    measure()
  }

  // A surface opened again, or one that stops being held, starts centred and unheld.
  watch(
    [surface, holds],
    () => {
      acted.value = false
      recentre()
    },
    { flush: 'post', immediate: true },
  )
  useResizeObserver(surface, measure)
  for (const kind of ACTS) useEventListener(surface, kind, act, { capture: true, passive: true })
  useEventListener(() => (typeof window === 'undefined' ? undefined : window), 'resize', recentre)

  return computed(() => (holds() ? offset.value : null))
}
