/**
 * A frame the keyboard can scroll, for as long as there is anything to scroll to.
 *
 * Chromium lets Tab into a scroller with no control in it on its own, Safari does not, so
 * the frame says so itself: `tabindex="0"` only while its content does not fit, because a
 * stop on a frame with nothing to scroll is a stop on nothing. The frame's width is what can
 * change the answer, so one observer watches the frames and only those: a document holds a
 * few of them among thousands of blocks, and what is read here is already laid out by the
 * time an observer is called. A new text in the same frame says so through `updated`.
 */
import type { ObjectDirective } from 'vue'

function mark(frame: Element) {
  if (frame.scrollWidth > frame.clientWidth) frame.setAttribute('tabindex', '0')
  else frame.removeAttribute('tabindex')
}

let observer: ResizeObserver | null = null
function frames() {
  observer ??= new ResizeObserver((entries) => {
    for (const { target } of entries) mark(target)
  })
  return observer
}

/** On a frame, with whether it should answer the keyboard at all. */
export const keyScroll: ObjectDirective<HTMLElement, boolean> = {
  mounted(frame, { value }) {
    if (value) frames().observe(frame)
  },
  updated(frame, { value }) {
    if (value) mark(frame)
  },
  unmounted(frame) {
    observer?.unobserve(frame)
  },
}
