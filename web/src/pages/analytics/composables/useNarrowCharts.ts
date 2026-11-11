/**
 * Whether the box a panel's charts stand in is too narrow for them: under 560 pixels a row of a
 * day's columns crowds its readout and a bar's name crowds its figure, so each chart opens as its
 * table. Unmeasured, the box is taken as wide enough, so nothing opens as a table before it is
 * known to have to.
 */
import { computed, ref } from 'vue'
import type { Ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

/** Under this width, in pixels, the charts open as their tables. */
const NARROW = 560

export function useNarrowCharts(box: Readonly<Ref<HTMLElement | null>>) {
  const width = ref<number | null>(null)
  useResizeObserver(box, ([entry]) => {
    if (entry) width.value = entry.contentRect.width
  })
  return computed(() => width.value !== null && width.value < NARROW)
}
