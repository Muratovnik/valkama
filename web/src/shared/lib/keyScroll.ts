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

const overflows = (frame: Element) => frame.scrollWidth > frame.clientWidth

function mark(frame: Element, scrolls: boolean) {
  if (scrolls) frame.setAttribute('tabindex', '0')
  else frame.removeAttribute('tabindex')
}

/**
 * Every frame is measured before any is marked: a mark between two measures leaves the
 * styles dirty, and the next measure lays the whole document out again, once per frame.
 * Forty frames in a long plan doubled the time from the press to the first painted block.
 */
let observer: ResizeObserver | null = null
function frames() {
  observer ??= new ResizeObserver((entries) => {
    const measured = entries.map(({ target }) => [target, overflows(target)] as const)
    for (const [target, scrolls] of measured) mark(target, scrolls)
  })
  return observer
}

/** On a frame, with whether it should answer the keyboard at all. */
export const keyScroll: ObjectDirective<HTMLElement, boolean> = {
  mounted(frame, { value }) {
    if (value) frames().observe(frame)
  },
  updated(frame, { value }) {
    if (value) mark(frame, overflows(frame))
  },
  unmounted(frame) {
    observer?.unobserve(frame)
  },
}
