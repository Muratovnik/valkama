/**
 * What a table's heading row and total need to stay at the edges of the panel's scroll while its
 * rows pass under them: their heights and the table's, in pixels, for the custom properties its
 * style reads (`SpendingTable`). The scroll itself moves them, through a view timeline the browser
 * runs with it; how far is the table's own height, which its rows, a crossing and the width set,
 * so only a change of size is measured here, never a scroll.
 */
import { computed, ref } from 'vue'
import type { Ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

export function useStuckEdges(box: Readonly<Ref<HTMLElement | null>>) {
  const sizes = ref({ head: 0, foot: 0, table: 0 })
  const table = () => box.value?.querySelector<HTMLElement>('table') ?? null

  useResizeObserver(table, () => {
    const grid = table()
    const height = (part: string) => grid?.querySelector<HTMLElement>(part)?.offsetHeight ?? 0
    sizes.value = { head: height('thead'), foot: height('tfoot'), table: grid?.offsetHeight ?? 0 }
  })

  return computed(() => {
    const { head, foot, table: whole } = sizes.value
    return { head, foot, table: whole, travel: Math.max(0, whole - head - foot) }
  })
}
