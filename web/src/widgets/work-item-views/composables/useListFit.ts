/**
 * How wide the list is, and so which of its columns stand (`fitFor`): read from
 * the list's own box, not the window's, since a panel beside it takes some of the
 * window.
 *
 * The rows are drawn once the list knows its own width (`measured`). Drawn
 * before, a phone drew a thousand rows with every column and at once drew them
 * all again with the columns folded, which doubled what opening the list cost
 * there.
 */
import { computed, onMounted, ref } from 'vue'
import type { Ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import { fitFor } from '@/widgets/work-item-views/utils/listColumns.ts'

/** `both` where the list draws «Goal and stage» and «Project», which stand from a wider list. */
export function useListFit(root: Ref<HTMLElement | null>, both = false) {
  const width = ref(0)
  const measured = ref(false)
  useResizeObserver(root, ([entry]) => {
    width.value = entry.contentRect.width
  })
  onMounted(() => {
    width.value = root.value?.clientWidth ?? 0
    measured.value = true
  })
  const fit = computed(() => fitFor(width.value, both))
  return {
    fit,
    measured,
    narrow: computed(() => fit.value === 'narrow'),
    width,
  }
}
