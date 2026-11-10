/**
 * The one place Tab lands in a chart whose periods or segments act, and where the arrows take
 * it from there (`nextCursor`). A chart of thirty days is one stop for Tab rather than thirty;
 * the stop is the place last stood on while it is still there, else the latest period, which
 * is the one a reader comes for. A press stands on what it pressed, so the next Tab returns
 * there. A move after a key is ringed, as `moveFocus` rings what the keyboard reached.
 */
import type { Ref } from 'vue'
import { computed, nextTick, ref } from 'vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import type { ChartCursor, StackedColumn } from '@/shared/ui/chartGeometry.ts'
import { nextCursor } from '@/shared/ui/chartGeometry.ts'

/** The attribute value the element a cursor names carries, for the move to find it. */
export function cellId(column: number, segment: number | null) {
  return segment === null ? `${column}:` : `${column}:${segment}`
}

export function useChartCursor(
  columns: () => readonly StackedColumn[],
  bySegment: () => boolean,
  root: Ref<HTMLElement | null>,
) {
  const cursor = ref<ChartCursor | null>(null)
  const standsOn = (index: number) => !bySegment() || (columns()[index]?.segments.length ?? 0) > 0

  const active = computed<ChartCursor | null>(() => {
    const all = columns()
    const wanted = cursor.value
    if (wanted && wanted.column < all.length && standsOn(wanted.column)) {
      const count = all[wanted.column]?.segments.length ?? 0
      const segment = bySegment() ? Math.min(wanted.segment ?? 0, count - 1) : null
      return { column: wanted.column, segment }
    }
    for (let index = all.length - 1; index >= 0; index -= 1)
      if (standsOn(index)) return { column: index, segment: bySegment() ? 0 : null }
    return null
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
    const next = nextCursor(columns(), at, event.key)
    if (!next) return
    event.preventDefault()
    cursor.value = next
    await nextTick()
    const id = cellId(next.column, next.segment)
    moveFocus(root.value?.querySelector<HTMLElement>(`[data-cell="${id}"]`))
  }

  return { move, standOn, tabStop }
}
