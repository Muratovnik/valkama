/**
 * What a table's heading row and total need to stay at the edges of the panel's scroll while its
 * rows pass under them: their heights and the table's, in pixels, for the custom properties its
 * style reads (`SpendingTable`). The scroll itself moves them, through a view timeline the browser
 * runs with it; how far is the table's own height, which its rows, a crossing and the width set,
 * so only a change of size is measured here, never a scroll.
 *
 * The box around the table is observed, not the table: the table is drawn anew inside it after it
 * opened — a split chosen or taken away, a split's read landing after a reload — and an observer of
 * the first table would never hear of the next one. The box is as tall as what it holds, so any
 * change of the table's size is a change of the box's, and each one asks for the table it holds now.
 */
import { computed, ref } from 'vue'
import type { Ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

export function useStuckEdges(box: Readonly<Ref<HTMLElement | null>>) {
  const sizes = ref({ head: 0, foot: 0, table: 0 })

  useResizeObserver(box, () => {
    const grid = box.value?.querySelector<HTMLElement>('table')
    const height = (part: string) => grid?.querySelector<HTMLElement>(part)?.offsetHeight ?? 0
    sizes.value = { head: height('thead'), foot: height('tfoot'), table: grid?.offsetHeight ?? 0 }
  })

  return computed(() => {
    const { head, foot, table: whole } = sizes.value
    return { head, foot, table: whole, travel: Math.max(0, whole - head - foot) }
  })
}
