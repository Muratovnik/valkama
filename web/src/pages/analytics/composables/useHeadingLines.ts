/**
 * How many lines the headings over a table's figures take (`SpendingTable`): one while the table,
 * every such heading on one line, stands in its frame, and two once one line would make it wider
 * than its frame. Which is so depends on the headings' words as much as on the frame — «Ранее,
 * 10 нояб., 00:00–14:30» over «Today» is longer than the week's — so it is measured, never guessed
 * from the frame's width alone: a width the week's table fitted left «Today»'s change past the
 * frame's edge.
 *
 * The table is laid out with one line and measured, and the answer is set before the browser
 * paints, so no frame shows the table wider than its frame. That happens once what the table holds
 * changes (`holds`), which may widen a column and leave the box around it as it was, and whenever
 * that box changes size. Laid out again, a table of six hundred rows took some 65 ms, twice for
 * each step of a window being resized while its headings were on two lines; so while the table
 * holds the same, the width it needs on one line is kept and only the frame's width is compared
 * with it. A box on one line is read without laying anything out again.
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
  /** How wide the table is with its headings on one line, until what it holds changes. */
  let oneLine: number | null = null

  function fit() {
    const section = box.value
    const frame = section?.querySelector<HTMLElement>('.chart-table-frame')
    const table = frame?.querySelector('table')
    if (!section || !frame || !table) return
    // Two lines, and the frame still narrower than one line needs: nothing to lay out.
    if (lines.value === 'two' && oneLine !== null && frame.clientWidth < oneLine) return
    // Set on the element as well as bound, so the measure reads one line now and the answer
    // stands on it before the next frame, whatever the binding does in between.
    section.dataset.headings = 'one'
    oneLine = table.offsetWidth
    lines.value = oneLine > frame.clientWidth ? 'two' : 'one'
    section.dataset.headings = lines.value
  }

  useResizeObserver(box, fit)
  watch(
    [...holds],
    () => {
      oneLine = null
      fit()
    },
    { flush: 'post' },
  )

  return lines
}
