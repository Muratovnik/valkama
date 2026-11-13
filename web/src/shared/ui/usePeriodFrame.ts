/**
 * The frame of a chart of periods, which takes whole periods: dragged along the plot, it covers
 * every period its two ends reach into, and stretched from the keyboard, the periods from the one
 * it started on to the one Shift and the arrows reached, the focus going with that end. It says
 * the periods it covers while it is drawn (`framed`), and the chart is told the first and the last
 * once it ends (`done`). A chart that does not frame (`frames`) draws and tells nothing.
 */
import type { Ref } from 'vue'
import { computed, nextTick } from 'vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { useAxisFrame, useKeyFrame } from '@/shared/ui/useAxisFrame.ts'
import { cellId } from '@/shared/ui/useChartCursor.ts'

export function usePeriodFrame(options: {
  field: Ref<HTMLElement | null>
  /** How many periods the chart has. */
  count: () => number
  done: (first: number, last: number) => void
  frames: () => boolean
  /** Stands the chart's cursor on a period, which the next Tab returns to. */
  standOn: (column: number, segment: null) => void
}) {
  const { field } = options

  /** The period whose slot reaches `offset` pixels into the field: the last, past every slot. */
  function periodAt(offset: number) {
    const slots = [...(field.value?.querySelectorAll<HTMLElement>('.period-slot') ?? [])]
    const start = field.value?.getBoundingClientRect().left ?? 0
    const at = slots.findIndex((slot) => slot.getBoundingClientRect().right - start >= offset)
    return at === -1 ? slots.length - 1 : at
  }

  const { drawn } = useAxisFrame(field, (from, to) => {
    if (options.frames()) options.done(periodAt(from), periodAt(to))
  })
  const keys = useKeyFrame(field, options.done)

  /** The periods a frame covers while it is drawn or stretched, first and last; none otherwise. */
  const framed = computed(() => {
    const pointer = drawn.value
    const stretched = keys.stretched.value
    if (!options.frames()) return null
    let ends: [number, number] | null = null
    if (pointer) ends = [periodAt(pointer.from), periodAt(pointer.to)]
    else if (stretched) ends = [stretched.anchor, stretched.reached]
    return ends && { first: Math.min(...ends), last: Math.max(...ends) }
  })

  /**
   * A key on the period at `index` or a segment of it: true where it stretched the frame, which
   * then stands the cursor on the period reached and takes the focus there.
   */
  function stretch(event: KeyboardEvent, index: number): boolean {
    if (!options.frames()) return false
    const reached = keys.stretch(event, index, options.count())
    if (reached === null) return false
    options.standOn(reached, null)
    void nextTick(() =>
      moveFocus(field.value?.querySelector<HTMLElement>(`[data-cell="${cellId(reached, null)}"]`)),
    )
    return true
  }

  return { framed, release: keys.release, stretch }
}
