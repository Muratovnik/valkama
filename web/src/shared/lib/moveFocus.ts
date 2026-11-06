import { pressedLast, takesTyping } from '@/shared/lib/pressFocus.ts'

/**
 * Takes focus somewhere in answer to what the reader did, ringed as their hand asks.
 *
 * Focus moves either way, so a screen reader follows and the next Tab starts from there. The
 * ring follows the input that came last (`pressFocus`): after the keyboard it is drawn, the one
 * sign of where a reader who does not point was taken; after a press of a mouse, pen or finger
 * it is not, since that reader sees where they are, and a ring round a reply just sent with the
 * mouse stood there for nothing. A move that ends a round trip reads the same input, which only
 * a press or a key changes and a pointer passing over the page does not. The ring is named
 * either way, and never left to the browser's guess about a focus a script places, except
 * where typing goes: a field shows focus after a press as after a key (`takesTyping`).
 *
 * Only for a move that answers a press or a change. Focus placed on an opening or put
 * back on a closing stays a plain `focus()`: a ring there would stand around something
 * nobody pressed.
 */
export function moveFocus(target: HTMLElement | null | undefined, options: FocusOptions = {}) {
  if (!target) return
  target.focus(takesTyping(target) ? options : { ...options, focusVisible: !pressedLast() })
}
