/**
 * How wide the list is, and so which of its columns stand (`fitFor`): read from
 * the list's own box, not the window's, since a panel beside it takes some of the
 * window, and less the room a tree's first column takes before its references
 * (`lead`), which the columns after it do not have.
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

/**
 * `both` where the list draws «Goal and stage» and «Project», which stand from a wider
 * list; `lead`, the pixels a tree's first column takes before its widest reference.
 */
export function useListFit(
  root: Ref<HTMLElement | null>,
  both = false,
  lead: () => number = () => 0,
) {
  const width = ref(0)
  const measured = ref(false)
  useResizeObserver(root, ([entry]) => {
    width.value = entry.contentRect.width
  })
  onMounted(() => {
    width.value = root.value?.clientWidth ?? 0
    measured.value = true
  })
  const fit = computed(() => fitFor(width.value, both, lead()))
  return {
    fit,
    measured,
    narrow: computed(() => fit.value === 'narrow'),
    width,
  }
}
