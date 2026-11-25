import { nextTick, watch } from 'vue'

import { focusOnNothing } from '@/shared/lib/focusRight.ts'

/**
 * Gives the focus back after a wait that disabled what held it. A form disables its controls
 * while a write it sent waits, and the browser takes focus off a control disabled under it, to
 * the page: a refused write then left the writer there, and the next Tab began wherever the
 * browser chose. So the control in `scope` that has focus as `waiting` turns true is read then,
 * before the render that disables it, and once the wait ends and focus still stands on nothing
 * (`focusOnNothing`), `giveBack` is handed it, for the form to put the focus there or where its
 * own rule says. A reader who put focus somewhere meanwhile keeps it there.
 */
export function useFocusThroughWait(
  scope: () => Element | null | undefined,
  waiting: () => boolean,
  giveBack: (held: HTMLElement) => void,
): void {
  let held: HTMLElement | null = null
  watch(
    waiting,
    (now) => {
      if (now) {
        const focused = document.activeElement
        held = focused instanceof HTMLElement && scope()?.contains(focused) ? focused : null
        return
      }
      const had = held
      held = null
      if (had)
        void nextTick(() => {
          if (focusOnNothing()) giveBack(had)
        })
    },
    { flush: 'pre' },
  )
}
