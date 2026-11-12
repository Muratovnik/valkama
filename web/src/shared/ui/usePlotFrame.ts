/**
 * The frame a chart's plot scrolls in when its periods, held to a width a pointer can hit, take
 * more room than the chart has. It measures the field the periods stand in, says how far into
 * the plot they start (the room the scale takes, which stays in view over the plot's start, so a
 * period scrolled to must stand clear of it), and opens a span of periods on its start, the
 * period's first day beside the scale, so the span reads from where it begins. It says at which
 * edge periods lie out of view (`hidden`), for the frame to show there that the plot goes on. A
 * reader's place holds while the plot's width settles and while the window changes.
 *
 * A period the keyboard reaches is brought clear of the scale here (`reveal`), not left to the
 * browser. Focus scrolls a frame only when what it lands on lies outside the frame's box, and
 * the scale is in that box: a span a few pixels wider than the chart opens with its first
 * period inside the box but under the scale, so Home stood on a period nobody could see.
 */
import type { Ref } from 'vue'
import { computed, ref, watch } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

/** What a box's edge may stray from another's by rounding alone, in pixels. */
const ROUNDING = 1

export function usePlotFrame(
  frame: Ref<HTMLElement | null>,
  plot: Ref<HTMLElement | null>,
  field: Ref<HTMLElement | null>,
  /** The periods shown, as one name: another name is another span. */
  span: () => string,
) {
  const width = ref(0)
  /** How far into the plot the periods start, in pixels. */
  const gutter = ref(0)
  /** Whether periods lie out of view before the scale's end, and past the frame's end. */
  const hiddenStart = ref(false)
  const hiddenEnd = ref(false)

  /** The scale can change its width under a field that keeps its own, so both observers measure. */
  const measure = () => {
    if (!field.value || !plot.value || !frame.value) return
    const periods = field.value.getBoundingClientRect()
    const room = frame.value.getBoundingClientRect()
    gutter.value = periods.left - plot.value.getBoundingClientRect().left
    hiddenStart.value = periods.left < room.left + gutter.value - ROUNDING
    hiddenEnd.value = periods.right > room.right + ROUNDING
  }
  useResizeObserver(field, ([entry]) => {
    if (!entry) return
    width.value = entry.contentRect.width
    measure()
  })
  useEventListener(frame, 'scroll', measure, { passive: true })
  // The room to scroll changes with the plot's width and with the frame's: a window made
  // narrower leaves the plot as wide as it was and hides more of its periods.
  useResizeObserver(plot, measure)
  useResizeObserver(frame, measure)

  let opened: string | null = null
  watch(
    [span, width],
    () => {
      if (!frame.value || !width.value || opened === span()) return
      opened = span()
      frame.value.scrollLeft = 0
      measure()
    },
    { flush: 'post' },
  )

  /**
   * Scrolls the frame, as far as it must, so `element` stands whole between the scale and the
   * frame's end. The room past the scale is the gap the plot keeps after it, which holds the
   * focus ring, as the frame's reach past the chart's end does at the other side.
   */
  function reveal(element: HTMLElement) {
    const box = frame.value
    if (!box) return
    const room = box.getBoundingClientRect()
    const own = element.getBoundingClientRect()
    const start = room.left + gutter.value
    if (own.left < start) box.scrollLeft -= start - own.left
    else if (own.right > room.right) box.scrollLeft += own.right - room.right
  }

  return {
    gutter: computed(() => `${gutter.value}px`),
    hidden: computed(() => ({ start: hiddenStart.value, end: hiddenEnd.value })),
    reveal,
    width,
  }
}
