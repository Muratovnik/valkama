/**
 * The line over a chart of periods (`PeriodColumns`): the period under the pointer or the
 * keyboard, and the last period when neither stands on one. It is two lines whatever it says —
 * the period, its sum and the period before with what is said of it, then the series, largest
 * first — so pointing at a period, leaving it or a new answer moves nothing on the page. Each
 * line ends in an ellipsis when it is longer than its room, and `whole` is the text said in full,
 * for the readout's hint.
 *
 * The pointer can reach that hint: on its way from a period up to the readout it leaves the
 * period, and the readout then says again the last period the pointer stood on (`kept`) while
 * the pointer is over it.
 */
import { computed, ref } from 'vue'

import type { PeriodWords, StackedColumn } from '@/shared/ui/chartGeometry.ts'
import { columnSummary, readoutLines } from '@/shared/ui/chartGeometry.ts'

export function usePeriodReadout(
  columns: () => readonly StackedColumn[],
  words: () => PeriodWords,
  format: () => (value: number) => string,
) {
  const hovered = ref<number | null>(null)
  const focused = ref<number | null>(null)
  const kept = ref<number | null>(null)
  const shownIndex = computed(() => hovered.value ?? focused.value ?? columns().length - 1)
  const readout = computed(() => {
    const shown = columns()[shownIndex.value]
    if (!shown) return { head: '', series: '', whole: '' }
    return {
      ...readoutLines(shown, words(), format()),
      whole: columnSummary(shown, words(), format()),
    }
  })

  /** The pointer stands on the period at `index`, or leaves it (null). */
  function point(index: number | null) {
    hovered.value = index
    if (index !== null) kept.value = index
  }

  return {
    focused,
    readout,
    isShown: (index: number) => index === shownIndex.value,
    point,
    /** The pointer reaches the readout (true) or leaves it: it keeps saying the last period. */
    hold: (over: boolean) => {
      hovered.value = over ? kept.value : null
    },
  }
}
