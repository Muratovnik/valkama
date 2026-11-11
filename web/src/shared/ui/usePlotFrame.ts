/**
 * The frame a chart's plot scrolls in when its periods, held to a width a pointer can hit, take
 * more room than the chart has. It measures the field the periods stand in, says how far into
 * the plot they start (the room the scale takes, which stays in view over the plot's start, so a
 * period scrolled to must stand clear of it), and opens a span of periods on its end, the ones
 * nearest now. A frame standing on its end stays there while the plot's width settles, as it
 * does when the scale's figures get their font, and while its own does, as when the window is
 * made narrower; one a reader scrolled away keeps their place.
 *
 * A period the keyboard reaches is brought clear of the scale here (`reveal`), not left to the
 * browser. Focus scrolls a frame only when what it lands on lies outside the frame's box, and
 * the scale is in that box: a span a few pixels wider than the chart opens with its first
 * period inside the box but under the scale, so Home stood on a period nobody could see.
 */
import type { Ref } from 'vue'
import { computed, ref, watch } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

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

  /** The scale can change its width under a field that keeps its own, so both observers measure. */
  const measure = () => {
    if (!field.value || !plot.value) return
    gutter.value =
      field.value.getBoundingClientRect().left - plot.value.getBoundingClientRect().left
  }
  useResizeObserver(field, ([entry]) => {
    if (!entry) return
    width.value = entry.contentRect.width
    measure()
  })

  const room = (element: HTMLElement) => element.scrollWidth - element.clientWidth
  const toEnd = () => {
    if (frame.value) frame.value.scrollLeft = room(frame.value)
  }
  let opened: string | null = null
  let atEnd = true
  useEventListener(
    frame,
    'scroll',
    () => {
      if (frame.value) atEnd = frame.value.scrollLeft >= room(frame.value) - 1
    },
    { passive: true },
  )
  // The room to scroll changes with the plot's width and with the frame's: a window made
  // narrower leaves the plot as wide as it was and takes the last periods out of view.
  const settle = () => {
    measure()
    if (atEnd) toEnd()
  }
  useResizeObserver(plot, settle)
  useResizeObserver(frame, settle)
  watch(
    [span, width],
    () => {
      if (!frame.value || !width.value || opened === span()) return
      opened = span()
      atEnd = true
      toEnd()
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

  return { gutter: computed(() => `${gutter.value}px`), reveal, width }
}
