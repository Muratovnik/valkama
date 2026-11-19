/**
 * The layers a period chart draws beside its data (`PeriodColumns`): the tick of the period
 * compared with (`outline`) and the line of a change at a period's start (`change`), each turned
 * off and on for every chart at once by its key in the legend (`chartLayersStore`).
 *
 * A layer turned off is not drawn, and nothing of it reaches the periods the chart stacks: no
 * figure of the period compared with, so its words leave a period's hint and name and its height
 * leaves the scale, and no change, so a period's hint, name and action say none. Its key's name
 * stays while the chart has the layer, drawn or off, so it can be turned on again. The columns'
 * figures are the data and always show.
 */
import { computed } from 'vue'

import { useChartLayer } from '@/shared/stores/chartLayersStore.ts'
import type { PeriodChartProps } from '@/shared/ui/chartGeometry.ts'

export function usePeriodLayers(
  chart: () => Pick<PeriodChartProps, 'columns' | 'marks' | 'words'>,
) {
  const { shown: outlineShown } = useChartLayer('outline')
  const { shown: changeShown } = useChartLayer('change')

  /** The periods as the plot draws them: without the figure compared with while that is off. */
  const columns = computed(() =>
    outlineShown.value
      ? chart().columns
      : chart().columns.map((column) => ({ ...column, before: undefined })),
  )
  /** The changes the plot marks: none while their layer is off. */
  const marks = computed(() => (changeShown.value ? (chart().marks ?? []) : []))

  /** The name of the mark of the period compared with, where the chart has one, drawn or off. */
  const outline = computed(() =>
    chart().columns.some((column) => column.before) ? chart().words.before : undefined,
  )
  /** The name of the line of a change at a period's start, where the plot has one, drawn or off. */
  const change = computed(() => {
    const { columns: periods, marks: changes = [], words } = chart()
    return changes.some((mark) => periods.some((column) => column.key === mark.at))
      ? words.change
      : undefined
  })

  return { change, columns, marks, outline }
}
