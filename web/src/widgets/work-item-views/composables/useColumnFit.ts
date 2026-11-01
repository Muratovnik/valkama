/**
 * The width a board's columns are drawn at, from the width its scroller shows.
 *
 * The scroller's content box is measured, which is what is visible: a vertical
 * scrollbar is outside it. The gap is read from the track the columns lie on,
 * so the spacing stays the stylesheet's to say. Until something is measured —
 * and wherever nothing can be, as in a test without layout — the answer is
 * empty and the stylesheet's own fallback track applies.
 */
import { computed, ref } from 'vue'
import type { Ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import { columnWidth } from '@/widgets/work-item-views/utils/boardColumns.ts'

export function useColumnFit(
  scroller: Ref<HTMLElement | null>,
  track: Ref<HTMLElement | null>,
  count: () => number,
) {
  const available = ref(0)
  const gap = ref(0)

  useResizeObserver(scroller, ([entry]) => {
    available.value = entry.contentRect.width
    const element = track.value
    gap.value = element === null ? 0 : Number.parseFloat(getComputedStyle(element).columnGap) || 0
  })

  const width = computed(() => columnWidth(available.value, count(), gap.value))
  return {
    /** The measured numbers behind the two strings, for a reader that has to do arithmetic with them. */
    measured: computed(() => ({ available: available.value, gap: gap.value, width: width.value })),
    /** Each column's width, or nothing to keep the stylesheet's own track. */
    columnWidth: computed(() => (width.value === null ? undefined : `${width.value}px`)),
    /**
     * The width the scroller shows, which a container query cannot give
     * because it counts a vertical scrollbar in.
     */
    visibleWidth: computed(() => (width.value === null ? undefined : `${available.value}px`)),
  }
}
