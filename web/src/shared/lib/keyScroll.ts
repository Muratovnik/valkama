/**
 * A frame the keyboard can scroll, for as long as there is anything to scroll to.
 *
 * Chromium lets Tab into a scroller with no control in it on its own, Safari does not, so
 * the frame says so itself: `tabindex="0"` only while its content does not fit, because a
 * stop on a frame with nothing to scroll is a stop on nothing. A stop is also a region with
 * the name the directive is given, the way an accessible scrolling table is built: a frame
 * reached by Tab and announced as nothing told a screen reader user nothing about what they
 * had come to. The frame's width is what can change the answer, so one observer watches the
 * frames and only those: a document holds a few of them among thousands of blocks, and what
 * is read here is already laid out by the time an observer is called. A new text in the same
 * frame says so through `updated`.
 *
 * While it scrolls, `data-more` says at which edge more of it is hidden, `start`, `end` or
 * both, for the frame to show a sighted reader that a column runs on past its edge.
 */
import type { ObjectDirective } from 'vue'

/** What a frame is called while it is a stop; false for one that never answers the keyboard. */
type FrameName = string | false

interface Measure {
  more: string
  scrolls: boolean
}

const names = new WeakMap<Element, string>()
const listeners = new WeakMap<Element, () => void>()

/** A pixel of slack, since a zoomed frame scrolls to fractions it rounds away. */
function measured(frame: Element): Measure {
  const { clientWidth, scrollWidth } = frame
  const scrolls = scrollWidth > clientWidth
  if (!scrolls) return { more: '', scrolls }
  const from = Math.abs(frame.scrollLeft)
  const edges = [from > 1 ? 'start' : '', from + clientWidth < scrollWidth - 1 ? 'end' : '']
  return { more: edges.filter(Boolean).join(' '), scrolls }
}

function setOrRemove(frame: Element, attribute: string, value: string) {
  if (value) frame.setAttribute(attribute, value)
  else frame.removeAttribute(attribute)
}

function mark(frame: Element, { more, scrolls }: Measure) {
  setOrRemove(frame, 'tabindex', scrolls ? '0' : '')
  setOrRemove(frame, 'role', scrolls ? 'region' : '')
  setOrRemove(frame, 'aria-label', scrolls ? (names.get(frame) ?? '') : '')
  setOrRemove(frame, 'data-more', more)
}

/**
 * Every frame is measured before any is marked: a mark between two measures leaves the
 * styles dirty, and the next measure lays the whole document out again, once per frame.
 * Forty frames in a long plan doubled the time from the press to the first painted block.
 */
let observer: ResizeObserver | null = null
function frames() {
  observer ??= new ResizeObserver((entries) => {
    const all = entries.map(({ target }) => [target, measured(target)] as const)
    for (const [target, measure] of all) mark(target, measure)
  })
  return observer
}

/** On a frame, with its name, or false where it should not answer the keyboard at all. */
export const keyScroll: ObjectDirective<HTMLElement, FrameName> = {
  mounted(frame, { value }) {
    if (value === false) return
    names.set(frame, value)
    const scrolled = () => setOrRemove(frame, 'data-more', measured(frame).more)
    listeners.set(frame, scrolled)
    frame.addEventListener('scroll', scrolled, { passive: true })
    frames().observe(frame)
  },
  updated(frame, { value }) {
    if (value === false) return
    names.set(frame, value)
    mark(frame, measured(frame))
  },
  unmounted(frame) {
    observer?.unobserve(frame)
    const scrolled = listeners.get(frame)
    if (scrolled) frame.removeEventListener('scroll', scrolled)
  },
}
