/**
 * The one place Tab lands in a chart of periods, and where the arrows take it from there
 * (`nextCursor`): every period, and each segment of one that acts. A chart of thirty days is one
 * stop for Tab rather than thirty; the stop is the place last stood on while it is still there,
 * else the latest period begun (`lastBegun`), which is the one a reader comes for. A press stands on what it pressed,
 * so the next Tab returns there. A move after a key is ringed, as `moveFocus` rings what the
 * keyboard reached.
 */
import type { Ref } from 'vue'
import { computed, nextTick, ref } from 'vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import type { ChartCursor, StackedColumn, StackSegment } from '@/shared/ui/chartGeometry.ts'
import { nextCursor } from '@/shared/ui/chartGeometry.ts'

/**
 * The last period begun: the one still running where one is, so a day read by its hours stops on
 * the hour under way rather than on the last hour of the day, still to come; the last otherwise.
 */
function lastBegun(columns: readonly StackedColumn[]): number {
  for (let index = columns.length - 1; index >= 0; index -= 1)
    if (columns[index]?.column.incomplete) return index
  return columns.length - 1
}

/** The attribute value the element a cursor names carries, for the move to find it. */
export function cellId(column: number, segment: number | null) {
  return segment === null ? `${column}:` : `${column}:${segment}`
}

export function useChartCursor(
  columns: () => readonly StackedColumn[],
  acts: (segment: StackSegment) => boolean,
  root: Ref<HTMLElement | null>,
) {
  const cursor = ref<ChartCursor | null>(null)

  const active = computed<ChartCursor | null>(() => {
    const all = columns()
    const wanted = cursor.value
    if (!all.length) return null
    if (!wanted || wanted.column >= all.length) return { column: lastBegun(all), segment: null }
    const segment =
      wanted.segment === null ? undefined : all[wanted.column]?.segments[wanted.segment]
    return segment && acts(segment) ? wanted : { column: wanted.column, segment: null }
  })

  function tabStop(column: number, segment: number | null) {
    const at = active.value
    return at?.column === column && at.segment === segment ? 0 : -1
  }

  function standOn(column: number, segment: number | null) {
    cursor.value = { column, segment }
  }

  async function move(event: KeyboardEvent) {
    const at = active.value
    if (!at) return
    const next = nextCursor(columns(), at, event.key, acts)
    if (!next) return
    event.preventDefault()
    cursor.value = next
    await nextTick()
    const id = cellId(next.column, next.segment)
    moveFocus(root.value?.querySelector<HTMLElement>(`[data-cell="${id}"]`))
  }

  return { move, standOn, tabStop }
}
