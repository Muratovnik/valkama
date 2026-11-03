import { watch } from 'vue'
import type { Ref } from 'vue'

import { useEventListener, useRafFn } from '@vueuse/core'

/**
 * How long the step of declining stands.
 *
 * While it stands, the place of Send declines for good at one press, so it lasts no longer than
 * the attention it was asked with. A press or focus landing outside its question ends it, which
 * also leaves a page with one step at most.
 *
 * That alone would let it outlast a pointer that merely went elsewhere, or a step taken with
 * the keys, and a question folding above could then bring that place under the pointer. So it
 * also holds only while its buttons stand where the press left them, whatever moves them: a
 * read, a scroll, a resize. They are compared on each frame, only while a step stands, and what
 * the pointer does or what is under it plays no part.
 *
 * A step that ended stays ended, so it cannot come back with a later deadline or a read.
 */
export function useStepAttention(
  question: Readonly<Ref<HTMLElement | null>>,
  standing: Readonly<Ref<boolean>>,
  end: () => void,
) {
  useEventListener(
    () => (standing.value ? document : null),
    ['pointerdown', 'focusin'],
    (event: Event) => {
      if (!question.value?.contains(event.target as Node)) end()
    },
    { capture: true },
  )
  const place = () => question.value?.querySelector('.request-actions')?.getBoundingClientRect()
  let left = place()
  const { pause, resume } = useRafFn(
    () => {
      const now = place()
      if (now?.x !== left?.x || now?.y !== left?.y) end()
    },
    { immediate: false },
  )
  watch(
    standing,
    (up) => {
      if (up) {
        left = place()
        resume()
      } else {
        pause()
        end()
      }
    },
    { flush: 'post' },
  )
}
