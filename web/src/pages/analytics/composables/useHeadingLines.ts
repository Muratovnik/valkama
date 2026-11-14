/**
 * How many lines the headings over a table's figures take (`SpendingTable`): one while the table,
 * every such heading on one line, stands in its frame, and two once one line would make it wider
 * than its frame. Which is so depends on the headings' words as much as on the frame — «Ранее,
 * 10 нояб., 00:00–14:30» over «Today» is longer than the week's — so it is measured, never guessed
 * from the frame's width alone: a width the week's table fitted left «Today»'s change past the
 * frame's edge.
 *
 * The table is laid out with one line and measured, and the answer is set before the browser
 * paints, so no frame shows the table wider than its frame. That happens whenever the box around
 * the table changes size, which a frame of another width, a table drawn anew or a row more does,
 * and once what the table holds changes (`holds`), which may widen a column and leave the box as
 * it was.
 */
import { ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { useResizeObserver } from '@vueuse/core'

type HeadingLines = 'one' | 'two'

export function useHeadingLines(
  box: Readonly<Ref<HTMLElement | null>>,
  holds: readonly WatchSource[],
) {
  const lines = ref<HeadingLines>('one')

  function fit() {
    const section = box.value
    const frame = section?.querySelector<HTMLElement>('.chart-table-frame')
    const table = frame?.querySelector('table')
    if (!section || !frame || !table) return
    // Set on the element as well as bound, so the measure reads one line now and the answer
    // stands on it before the next frame, whatever the binding does in between.
    section.dataset.headings = 'one'
    lines.value = table.offsetWidth > frame.clientWidth ? 'two' : 'one'
    section.dataset.headings = lines.value
  }

  useResizeObserver(box, fit)
  watch([...holds], fit, { flush: 'post' })

  return lines
}
