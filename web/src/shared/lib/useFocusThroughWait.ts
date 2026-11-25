import { nextTick, watch } from 'vue'

import { focusOnNothing } from '@/shared/lib/focusRight.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'

/** What held focus takes it back, as a key or a press put it there, if it still stands. */
function backOn(held: HTMLElement) {
  if (held.isConnected) moveFocus(held, { preventScroll: true })
}

/**
 * Gives the focus back after a wait that disabled what held it. A form disables its controls
 * while a write it sent or a read it asked for waits, and the browser takes focus off a
 * control disabled under it, to the page: a refused write or a failed read then left the
 * reader there, and the next Tab began wherever the browser chose. So the control in `scope` that has focus as `waiting` turns true is read then,
 * before the render that disables it, and once the wait ends and focus still stands on nothing
 * (`focusOnNothing`), `giveBack` is handed it, for the form to put the focus there or where its
 * own rule says; by default it goes back to that control, unless the wait took it away. A reader
 * who put focus somewhere meanwhile keeps it there.
 */
export function useFocusThroughWait(
  scope: () => Element | null | undefined,
  waiting: () => boolean,
  giveBack: (held: HTMLElement) => void = backOn,
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
