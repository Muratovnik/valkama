/**
 * The frame a chart's plot scrolls in when its periods, held to a width a pointer can hit, take
 * more room than the chart has. It measures the field the periods stand in, says how far into
 * the plot they start (the room the scale takes, which stays in view over the plot's start, so a
 * period scrolled to must stand clear of it), and opens a span of periods on its end, the ones
 * nearest now. A frame standing on its end stays there while the plot's width settles, as it
 * does when the scale's figures get their font, and while its own does, as when the window is
 * made narrower; one a reader scrolled away keeps their place.
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

  return { gutter: computed(() => `${gutter.value}px`), width }
}
