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
 * height the layout keeps for it.
 *
 * The line's own second row, where what moves under the frame goes when the reference
 * leaves it no room, is offered only by a band with room for it at full size; elsewhere
 * that mark shortens to its count beside the dots (`GraphFrameLine`), as it does far out.
 */
import { onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

interface BandFitInput {
  head: Readonly<Ref<HTMLElement | null>>
  overview: () => boolean
  /** What, read again, may change the room or the rows. */
  sources: () => unknown[]
}

/** The height of `element` the layout keeps, or nothing when it is not drawn. */
const kept = (element: Element | null) =>
  element instanceof HTMLElement ? element.offsetHeight : 0

export function useGraphBandFit(input: BandFitInput) {
  const fit = ref(1)
  /** Whether the band holds the line's second row at full size. */
  const secondRow = ref(true)

  function measure() {
    const head = input.head.value
    if (!head || !input.overview()) {
      fit.value = 1
      return
    }
    const style = getComputedStyle(head)
    // The rows as designed: what is drawn now, at the factor drawn now.
    const line = kept(head.querySelector('.graph-frame-line')) / fit.value
    const inside = kept(head.querySelector('.graph-frame-inside')) / fit.value
    const edge = head.querySelector<HTMLElement>('.frame-progress')
    const foot = edge ? edge.offsetHeight + Number.parseFloat(style.rowGap) : 0
    const room =
      head.clientHeight -
      Number.parseFloat(style.paddingTop) -
      Number.parseFloat(style.paddingBottom) -
      foot
    fit.value = line + inside > 0 ? Math.min(1, room / (line + inside)) : 1
    secondRow.value = room >= 2 * line
  }

  onMounted(measure)
  watch(input.sources, measure, { flush: 'post' })

  return { fit, secondRow }
}
