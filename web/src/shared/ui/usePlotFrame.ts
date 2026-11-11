/**
 * The frame a chart's plot scrolls in when its periods, held to a width a pointer can hit, take
 * more room than the chart has. It measures the field the periods stand in, says how far into
 * the plot they start (the room the scale takes, which stays in view over the plot's start, so a
 * period scrolled to must stand clear of it), and opens a span of periods on its end, the ones
 * nearest now: once for each span, never again on a resize, so a reader's own scroll is kept.
 */
import type { Ref } from 'vue'
import { computed, ref, watch } from 'vue'

import { useResizeObserver } from '@vueuse/core'

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

  useResizeObserver(field, ([entry]) => {
    if (!entry) return
    width.value = entry.contentRect.width
    if (plot.value)
      gutter.value =
        entry.target.getBoundingClientRect().left - plot.value.getBoundingClientRect().left
  })

  let opened: string | null = null
  watch(
    [span, width],
    () => {
      const element = frame.value
      if (!element || !width.value || opened === span()) return
      opened = span()
      element.scrollLeft = element.scrollWidth - element.clientWidth
    },
    { flush: 'post' },
  )

  return { gutter: computed(() => `${gutter.value}px`), width }
}
