import { watch } from 'vue'
import type { Ref } from 'vue'

import { useEventListener, useRafFn } from '@vueuse/core'

import { strayThisPress } from '@/shared/ui/strayPress.ts'

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
 * A frame comes only after the page has changed, and a press can land in between. So they are
 * compared again when a press goes down, and one that finds them moved ends the step there; if
 * it went down on them, it was aimed at where they stood before, and it reaches neither, or
 * the place of Send would send what the form holds. A key on a button in focus aims at
 * nothing and is left to the frame.
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
  const actions = () => question.value?.querySelector('.request-actions')
  const place = () => actions()?.getBoundingClientRect()
  let left = place()
  const moved = () => {
    const now = place()
    return now?.x !== left?.x || now?.y !== left?.y
  }
  useEventListener(
    () => (standing.value ? document : null),
    'pointerdown',
    (event: PointerEvent) => {
      if (!moved()) return
      end()
      if (actions()?.contains(event.target as Node)) strayThisPress()
    },
    { capture: true },
  )
  const { pause, resume } = useRafFn(
    () => {
      if (moved()) end()
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
