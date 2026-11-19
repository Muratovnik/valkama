import { watch } from 'vue'
import type { Ref } from 'vue'

import { useEventListener, useRafFn } from '@vueuse/core'

import { scrollerOf } from '@/features/input-requests/composables/useUncoveredFocus.ts'

import { strayThisPress } from '@/shared/ui/strayPress.ts'

/** The air kept between what sticks over the top of the panel and what stands under it. */
const CLEARANCE = 8

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
 *
 * What the screen moved before the step began is not the reader's: the list of work a refused
 * answer would cancel comes over the buttons as its asking stands again, and on a phone it pushed
 * them past the fold, so the press that scrolled to them ended the step it was meant to confirm.
 * So the step brings its buttons into view, by no more than it takes, before it takes their
 * place; a scroll the reader makes after that still moves them, and ends it.
 *
 * What came over the buttons may be taller than the panel, and then bringing them into view took
 * its first line, where focus is, past the top. So first what stands over them and scrolls inside
 * itself (`data-step-room`) is held to the room the panel leaves above them, under what sticks to
 * its top (`data-stuck-edge="start"`): its height is the panel's room (`--step-room`), and both its
 * first line and the buttons stand in view. Scrolling inside it moves no button.
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
  function fitRoom() {
    const room = question.value?.querySelector<HTMLElement>('[data-step-room]')
    const buttons = actions()
    const scroller = room ? scrollerOf(room) : null
    if (!room || !buttons || !scroller) return
    const stuck = [...(question.value?.querySelectorAll('[data-stuck-edge="start"]') ?? [])]
      .filter((edge) => !edge.contains(room))
      .reduce((sum, edge) => sum + edge.getBoundingClientRect().height, 0)
    const below = buttons.getBoundingClientRect().bottom - room.getBoundingClientRect().bottom
    const free = scroller.clientHeight - stuck - below - CLEARANCE
    room.style.setProperty('--step-room', `${Math.max(0, Math.floor(free))}px`)
  }
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
        fitRoom()
        actions()?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' })
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
