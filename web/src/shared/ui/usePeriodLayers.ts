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
 *
 * A layer the chart lacks because its read failed (`unread`) keeps its key's room in the legend,
 * unseen (`unseen`), so nothing under the legend moves when a later read brings the layer: a new
 * view whose accounts or period before could not be read drew its legend a line shorter, and the
 * retry that read them moved what stands under the chart down by that line.
 */
import { computed } from 'vue'

import { useChartLayer } from '@/shared/stores/chartLayersStore.ts'
import type { PeriodChartProps, PeriodLayer } from '@/shared/ui/chartGeometry.ts'

export function usePeriodLayers(
  chart: () => Pick<PeriodChartProps, 'columns' | 'marks' | 'unread' | 'words'>,
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

  /** The layers whose read failed and that the chart lacks: their keys' room is held unseen. */
  const unseen = computed<PeriodLayer[]>(() => {
    const has = { outline: Boolean(outline.value), change: Boolean(change.value) }
    return (chart().unread ?? []).filter((layer) => !has[layer])
  })
  /**
   * The keys the legend names, by their words: each layer the chart has, and each it lacks
   * because its read failed, whose room the legend holds unseen.
   */
  const keys = computed(() => {
    const { words } = chart()
    const held = (layer: PeriodLayer) => unseen.value.includes(layer)
    return {
      outline: outline.value ?? (held('outline') ? words.before : undefined),
      change: change.value ?? (held('change') ? words.change : undefined),
      unseen: unseen.value,
    }
  })

  return { columns, keys, marks, outline }
}
