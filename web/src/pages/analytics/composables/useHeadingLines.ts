/**
 * How many lines the headings over a table's figures take (`SpendingTable`): one while the table,
 * every such heading on one line, stands in its frame, and two once one line would make it wider
 * than its frame. Which is so depends on the headings' words as much as on the frame — «Ранее,
 * 10 нояб., 00:00–14:30» over «Today» is longer than the week's — so it is measured, never guessed
 * from the frame's width alone: a width the week's table fitted left «Today»'s change past the
 * frame's edge.
 *
 * A table that asks it (`wraps`), the Model section's, has its figures' words measured the same
 * way after its headings: a figure that is words, «No tokens», and the remark under a cost, «201.3K
 * tokens without a price», keep to one line while the table, its headings on two lines if they
 * must, still stands in its frame on one, and wrap only once it would not. Wrapped always, they
 * took three and four lines at 1440 pixels, where the table had room for each on one.
 *
 * The table is laid out a step at a time, each step measured, and the answer is set before the
 * browser paints, so no frame shows the table wider than its frame. That happens once what the
 * table holds changes (`holds`), which may widen a column and leave the box around it as it was,
 * and whenever that box changes size. Laid out again, a table of six hundred rows took some 65 ms,
 * twice for each step of a window being resized while its headings were on two lines; so while
 * the table holds the same, the width each step that did not fit needed is kept and only the
 * frame's width is compared with it. The last step is the one left, and is never measured.
 */
import { ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { useResizeObserver } from '@vueuse/core'

/** The lines of the table's parts: its headings over figures, and its figures' words. */
interface TableLines {
  /** Its figures' words on one line, or wrapped inside their column; null where they never wrap. */
  figures: 'one' | 'wrap' | null
  headings: 'one' | 'two'
}

/** The steps a table gives its width by, in order: first its headings', then its words'. */
const HEADINGS_STEPS: readonly TableLines[] = [
  { figures: null, headings: 'one' },
  { figures: null, headings: 'two' },
]
const WORDS_STEPS: readonly TableLines[] = [
  { figures: 'one', headings: 'one' },
  { figures: 'one', headings: 'two' },
  { figures: 'wrap', headings: 'two' },
]

export function useHeadingLines(
  box: Readonly<Ref<HTMLElement | null>>,
  holds: readonly WatchSource[],
  wraps: () => boolean = () => false,
) {
  const lines = ref<TableLines>(HEADINGS_STEPS[0] ?? { figures: null, headings: 'one' })
  /** How wide the table is at each step that did not fit, until what it holds changes. */
  let needs: (number | undefined)[] = []

  function apply(section: HTMLElement, step: TableLines) {
    // Set on the element as well as bound, so the measure reads the step now and the answer
    // stands on it before the next frame, whatever the binding does in between.
    section.dataset.headings = step.headings
    if (step.figures) section.dataset.figures = step.figures
    else delete section.dataset.figures
  }

  function fit() {
    const section = box.value
    const frame = section?.querySelector<HTMLElement>('.chart-table-frame')
    const table = frame?.querySelector('table')
    if (!section || !frame || !table) return
    const steps = wraps() ? WORDS_STEPS : HEADINGS_STEPS
    let chosen = steps.at(-1) ?? lines.value
    for (const [index, step] of steps.entries()) {
      const last = index === steps.length - 1
      const need = needs[index]
      // A step known to need more than the frame holds: nothing to lay out.
      if (!last && need !== undefined && frame.clientWidth < need) continue
      apply(section, step)
      if (last) break
      const width = table.offsetWidth
      if (width <= frame.clientWidth) {
        chosen = step
        break
      }
      needs[index] = width
    }
    apply(section, chosen)
    lines.value = chosen
  }

  useResizeObserver(box, fit)
  watch(
    [...holds, wraps],
    () => {
      needs = []
      fit()
    },
    { flush: 'post' },
  )

  return lines
}
