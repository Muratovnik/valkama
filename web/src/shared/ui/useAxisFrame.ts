/**
 * A frame along a chart's time axis, the two ways a reader draws one.
 *
 * With a mouse or a pen it is dragged (`useAxisFrame`): from where the press went down to where
 * the pointer is, as distances in pixels from the start of the field the chart draws in, so a
 * frame holds its place while the plot scrolls under it. A press becomes a frame only once it has
 * moved `FRAME_START` pixels along the axis, so a press that stays where it went down is still a
 * press of what it landed on; the click that ends a frame presses nothing. A finger scrolls the
 * plot sideways as before and draws no frame. Escape, or a press the browser takes back, lets the
 * frame go without a word.
 *
 * From the keyboard it is stretched (`useKeyFrame`): Shift with Left or Right stretches it from
 * the place stood on — a period, a reading — to the next, and letting Shift go ends it, where it
 * covers more than the place it started on. Escape, or focus leaving the chart, lets it go.
 *
 * The chart reads each frame to draw it, and is told it once it ends (`done`): a dragged frame by
 * its two ends in pixels, a stretched one by its first and last place, each in the axis's order.
 */
import type { Ref } from 'vue'
import { ref } from 'vue'

import { useEventListener } from '@vueuse/core'

/** How far a press moves along the axis before it is a frame and no longer a press, in pixels. */
const FRAME_START = 4

/** A frame's two ends, in pixels from the field's start: where it began and where it is now. */
export interface AxisFrame {
  from: number
  to: number
}

/** A frame stretched from the keyboard: the place it started on and the place it reached. */
export interface KeyFrame {
  anchor: number
  reached: number
}

/** Stops a click from pressing anything. */
function swallow(event: MouseEvent) {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * Swallows the click a frame's release would send, so a frame that ends on a period presses no
 * period. The browser sends that click straight after the release, or none where the press began
 * and ended on two parts; the next task forgets it either way.
 */
function swallowNextClick() {
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }))
}

export function useAxisFrame(
  field: Ref<HTMLElement | null>,
  done: (from: number, to: number) => void,
) {
  const drawn = ref<AxisFrame | null>(null)
  let start: { at: number; pointer: number; x: number } | null = null

  const offsetOf = (x: number) => {
    const box = field.value?.getBoundingClientRect()
    return box ? Math.min(Math.max(x - box.left, 0), box.width) : 0
  }

  function letGo() {
    start = null
    drawn.value = null
  }

  useEventListener(field, 'pointerdown', (event: PointerEvent) => {
    if (event.button !== 0 || event.pointerType === 'touch') return
    start = { at: offsetOf(event.clientX), pointer: event.pointerId, x: event.clientX }
  })
  // A link's segment would start the browser's own drag of the link, which ends the press.
  useEventListener(field, 'dragstart', (event: DragEvent) => {
    if (start) event.preventDefault()
  })
  useEventListener(document, 'pointermove', (event: PointerEvent) => {
    if (!start || event.pointerId !== start.pointer) return
    if (!drawn.value && Math.abs(event.clientX - start.x) < FRAME_START) return
    drawn.value = { from: start.at, to: offsetOf(event.clientX) }
  })
  useEventListener(document, 'pointerup', (event: PointerEvent) => {
    if (!start || event.pointerId !== start.pointer) return
    const frame = drawn.value
    letGo()
    if (!frame) return
    swallowNextClick()
    done(Math.min(frame.from, frame.to), Math.max(frame.from, frame.to))
  })
  useEventListener(document, 'pointercancel', letGo)
  useEventListener(document, 'keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape' && drawn.value) letGo()
  })

  return { drawn }
}

/** The keys that stretch a frame, said to assistive technology on each place they stretch from. */
export const FRAME_KEYS = 'Shift+ArrowLeft Shift+ArrowRight'

const STEPS: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1 }

export function useKeyFrame(
  field: Ref<HTMLElement | null>,
  done: (first: number, last: number) => void,
) {
  const stretched = ref<KeyFrame | null>(null)

  /**
   * Answers a key on the place at `index` of `count`: the place a frame stretched to, the key
   * taken; null for a key that stretches nothing, which the chart answers as it does any key.
   * Escape lets a stretched frame go.
   */
  function stretch(event: KeyboardEvent, index: number, count: number): number | null {
    if (event.key === 'Escape') stretched.value = null
    const step = STEPS[event.key]
    if (!event.shiftKey || step === undefined) return null
    event.preventDefault()
    const reached = Math.min(count - 1, Math.max(0, index + step))
    stretched.value = { anchor: stretched.value?.anchor ?? index, reached }
    return reached
  }

  /** Shift let go ends a stretched frame, told where it covers more than where it started. */
  function release(event: KeyboardEvent) {
    const frame = stretched.value
    if (event.key !== 'Shift' || !frame) return
    stretched.value = null
    if (frame.anchor !== frame.reached)
      done(Math.min(frame.anchor, frame.reached), Math.max(frame.anchor, frame.reached))
  }

  useEventListener(field, 'focusout', (event: FocusEvent) => {
    if (!(event.relatedTarget instanceof Node) || !field.value?.contains(event.relatedTarget))
      stretched.value = null
  })

  return { release, stretch, stretched }
}
