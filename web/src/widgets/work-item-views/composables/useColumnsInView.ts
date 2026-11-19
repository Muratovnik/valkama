/**
 * Which of a board's columns its sideways scroll shows, as the first and last
 * index in view. The scroll is read once a frame at most, and each index is a
 * number, so a scroll that stays inside one column changes nothing downstream.
 * `narrow` are the indices of the columns folded to a strip.
 */
import { computed, ref } from 'vue'
import type { Ref } from 'vue'

import { useEventListener } from '@vueuse/core'

import { columnsInView } from '@/widgets/work-item-views/utils/boardColumns.ts'

export function useColumnsInView(
  scroller: Ref<HTMLElement | null>,
  measured: Ref<{ available: number; gap: number; width: number | null }>,
  count: () => number,
  narrow: () => ReadonlySet<number> = () => new Set(),
) {
  const scrollLeft = ref(0)
  let reading = 0
  useEventListener(
    scroller,
    'scroll',
    () => {
      if (reading !== 0) return
      reading = requestAnimationFrame(() => {
        reading = 0
        scrollLeft.value = scroller.value?.scrollLeft ?? 0
      })
    },
    { passive: true },
  )
  const inView = computed(() =>
    columnsInView({
      ...measured.value,
      count: count(),
      narrow: narrow(),
      scrollLeft: scrollLeft.value,
    }),
  )
  return {
    first: computed(() => inView.value.first),
    last: computed(() => inView.value.last),
  }
}
