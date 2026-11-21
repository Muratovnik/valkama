/**
 * What a chart's table gives up so it never scrolls in its frame by a sliver (`ChartTable`). A
 * table is as wide as its columns' least: the name's longest word, each heading over figures at
 * its floor (`chartTable.css`), a note's longest word. Where those come to a few pixels more than
 * the frame, the frame scrolled by those few, short of anything a reader could reach that was not
 * in reach already: the period table of a section at 1024 pixels ran 5 to 18 pixels past its
 * frame, its note's last letters under the edge. So where the table runs past its frame by less
 * than the least target (`--period-reach`, 24px), the headings standing at their floor give the
 * difference between them (`--chart-table-give`), and the table fits; a table wider by more
 * scrolls, as one wider than its column does. What a column holds is never cut for it: a figure
 * keeps its line and a note its words, so a column held by them gives nothing.
 *
 * It is measured, never guessed from the frame's width: which columns stand at their floor
 * depends on their words. The give is taken back and the table measured anew whenever the frame
 * or the table changes size, which a change of what the table holds does.
 */
import type { Ref } from 'vue'
import { computed } from 'vue'

import { useResizeObserver } from '@vueuse/core'

/** The least sideways scroll that brings anything into reach: the least target, in px. */
const LEAST_SCROLL = 24

/** The property the headings over figures take their floor's give from. */
const GIVE = '--chart-table-give'

/** Whether a heading over figures stands at its floor: no wider than its least. */
function atFloor(cell: HTMLTableCellElement) {
  const least = Number.parseFloat(getComputedStyle(cell).minInlineSize) || 0
  return least > 0 && cell.getBoundingClientRect().width <= least + 0.5
}

export function useChartTableGive(frame: Readonly<Ref<HTMLElement | null>>) {
  const table = computed(() => frame.value?.querySelector('table') ?? null)

  /**
   * Takes the give back, and where the table then runs a sliver past its frame, shares what it
   * runs past among the headings at their floor; a column its figures or words hold wider gives
   * nothing, so what is left is shared again among the rest, twice at most.
   */
  function fit() {
    const box = frame.value
    const held = table.value
    if (!box || !held) return
    box.style.removeProperty(GIVE)
    const pastOf = () => held.getBoundingClientRect().width - box.clientWidth
    if (pastOf() >= LEAST_SCROLL) return
    let give = 0
    for (let round = 0; round < 3; round += 1) {
      const past = pastOf()
      if (past <= 0.5) return
      const floored = [...(held.tHead?.rows[0]?.cells ?? [])].filter(
        (cell) => cell.dataset.numeric === 'true' && atFloor(cell),
      )
      if (!floored.length) return
      give += Math.ceil((past / floored.length) * 10) / 10
      box.style.setProperty(GIVE, `${give}px`)
    }
  }

  useResizeObserver(
    computed(() => [frame.value, table.value]),
    fit,
  )
}
