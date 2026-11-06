/**
 * How far a zoomed-out header's words may grow: as far as they are designed to, or as far
 * as the header holds them, whichever is less.
 *
 * A header is as tall as its lines at reading size, one to three of title, so the band
 * it becomes zoomed out has the room those lines left and no more. Grown past it, the
 * reference stood over the edge and what a fold hides ran into the frame below. So the
 * band reads the room it has and the rows it grows — the reference line, and under it
 * what a fold hides — and both are grown by one factor, `--band-fit`, under 1 only where
 * they would not fit. A transform leaves the layout as it was, so each row is read at the
 * height the layout keeps for it, and divided by the factor those rows are drawn at now.
 *
 * It measures again whenever one of them, or the band, changes size. Read only in the
 * update that turned the band on, the rows had not yet taken the band's size, the line
 * 37px tall for its 51 and the edge 3px for its 12: the band kept a factor of 0.82 where
 * 0.61 fit, and what a fold hides ran onto the edge under it.
 *
 * The line's own second row, where what moves under the frame goes when the reference
 * leaves it no room, is offered only by a band with room for it at full size; elsewhere
 * that mark shortens to its count beside the dots (`GraphFrameLine`), as it does far out.
 */
import { onMounted, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

interface BandFitInput {
  head: Readonly<Ref<HTMLElement | null>>
  overview: () => boolean
  /** What, read again, may change the room or the rows. */
  sources: () => unknown[]
}

/**
 * The height of `element` the layout keeps, to the fraction, or nothing when it is not
 * drawn. Read in whole pixels, a row a fraction off moved the factor that sized it, and
 * the band measured itself again, and again, a pixel each way.
 */
const kept = (element: Element | null) =>
  element instanceof HTMLElement ? Number.parseFloat(getComputedStyle(element).height) || 0 : 0

/** A factor nearer than this to the one drawn is the same: nothing to draw again. */
const SAME = 0.001

export function useGraphBandFit(input: BandFitInput) {
  const fit = ref(1)
  /** Whether the band holds the line's second row at full size. */
  const secondRow = ref(true)

  /** The band and the rows it holds, each watched for a change of size. */
  const watched = shallowRef<HTMLElement[]>([])

  function measure() {
    const head = input.head.value
    if (!head || !input.overview()) {
      fit.value = 1
      watched.value = []
      return
    }
    const style = getComputedStyle(head)
    const rows = ['.graph-frame-line', '.graph-frame-inside', '.frame-progress'].map((row) =>
      head.querySelector<HTMLElement>(row),
    )
    const [lineRow, insideRow, edge] = rows
    const now = [head, ...rows.filter((row) => row !== null)]
    if (now.length !== watched.value.length || now.some((row, at) => row !== watched.value[at]))
      watched.value = now
    // The rows as designed: what is drawn now, at the factor it is drawn at.
    const drawn = Number.parseFloat(style.getPropertyValue('--band-fit')) || 1
    const line = kept(lineRow) / drawn
    const inside = kept(insideRow) / drawn
    const foot = edge ? kept(edge) + Number.parseFloat(style.rowGap) : 0
    const room =
      head.clientHeight -
      Number.parseFloat(style.paddingTop) -
      Number.parseFloat(style.paddingBottom) -
      foot
    const next = line + inside > 0 ? Math.min(1, room / (line + inside)) : 1
    if (Math.abs(next - fit.value) > SAME) fit.value = next
    secondRow.value = room >= 2 * line
  }

  onMounted(measure)
  watch(input.sources, measure, { flush: 'post' })
  useResizeObserver(watched, measure)

  return { fit, secondRow }
}
