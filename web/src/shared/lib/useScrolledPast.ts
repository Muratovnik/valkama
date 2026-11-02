import { ref } from 'vue'
import type { MaybeRefOrGetter } from 'vue'

import { useIntersectionObserver } from '@vueuse/core'

/**
 * Whether an element has gone past the top of the scroller it stands in.
 *
 * Only past the top: an element below the fold of a short window has not been read
 * yet, and is as far from gone as one in plain view. The browser reports the crossing,
 * so nothing runs per scrolled pixel.
 */
export function useScrolledPast(
  target: MaybeRefOrGetter<HTMLElement | null | undefined>,
  scroller: MaybeRefOrGetter<HTMLElement | null | undefined>,
) {
  const past = ref(false)
  useIntersectionObserver(
    target,
    (entries) => {
      const entry = entries.at(-1)
      if (!entry) return
      const top = entry.rootBounds?.top ?? 0
      past.value = !entry.isIntersecting && entry.boundingClientRect.bottom <= top
    },
    { root: scroller },
  )
  return past
}
