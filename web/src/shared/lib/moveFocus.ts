/**
 * Takes focus somewhere in answer to what the reader did, and rings it.
 *
 * The ring is drawn by `:focus-visible` alone, so a press of the pointer rings nothing:
 * the reader knows what they pressed. A `focus()` that says nothing is treated the same
 * way, ringed only when the keyboard was the last thing used (`pressFocus`), so after a click
 * the reader was taken to a failed write's reason, a deadline or the next question with
 * no sign of where they went. This asks for the ring whatever came before.
 *
 * Only for a move that answers a press or a change. Focus placed on an opening or put
 * back on a closing stays a plain `focus()`: a ring there would stand around something
 * nobody pressed.
 */
export function moveFocus(target: HTMLElement | null | undefined, options: FocusOptions = {}) {
  target?.focus({ ...options, focusVisible: true })
}
