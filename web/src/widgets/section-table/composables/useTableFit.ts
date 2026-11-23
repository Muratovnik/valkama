/**
 * How a table stands in its frame, decided by whether its columns fit the frame's width and never
 * by the window's: a section's table (`SectionTable`) and the tables a page draws in chart tables'
 * frames (`VolumesCommits`, `VolumesOutside`), every table in the box at one step, so tables of
 * one section keep alike headings. The tables are laid out at each step in turn and stand at the
 * first one where every column of each stands inside its frame:
 *
 * - `one`: every heading on one line;
 * - `two`: the headings over figures on two lines, each such column at least 7em wide;
 * - `least`: every column at the least that breaks no word — the headings over figures as narrow
 *   as their longest word, and what the page lets give way there, such as a goal's words in
 *   Volumes, which keep 11rem while the table has room for them and come down to their longest
 *   word where it has not.
 *
 * Where no step fits, the table takes the page's answer for that (`otherwise`): a table of
 * records read as words, and Volumes' work outside goals with each figure beside its category's
 * name, stands each record as a block of its own (`stack`), and another table of figures keeps its
 * headings on two lines and scrolls sideways in its frame, its names held at its start; the least
 * only pays for its narrower columns when it brings every column in. Which step fits depends on
 * the words as much as on the frame — in Analytics «Ранее, 10 нояб., 00:00–14:30» over «Today» is
 * longer than the week's — so it is measured, never guessed from a width: a table of words
 * stacked by the width of a phone alone left «What was decided» past its frame at 1024 and 760,
 * and the goals of Volumes, held to their columns, left «Осталось ≈» past it at 1280.
 *
 * Each step is read in its own layout and the answer is set before the browser paints, so no frame
 * shows the table wider than its frame. That happens once what the table holds changes (`holds`),
 * once a font arrives, and whenever the box around it changes size. Laid out again, a table of seven
 * hundred rows took some 40 ms, so while the table holds the same, the width a step ran past its
 * frame at is kept, and the step is not laid out again where a frame, given even the room its
 * scrollbar takes, is narrower than that; the frames of one box are as wide as each other.
 */
import { ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

/** The steps a table is laid out at, narrowest last, and its block layout (`stack`). */
export type TableFit = 'one' | 'two' | 'least' | 'stack'

/** The steps a table may stand at, in order, and what it does where none of them fits. */
export interface TableFitRule {
  otherwise: TableFit
  steps: readonly TableFit[]
}

/** A table and the frame it scrolls in. */
interface Framed {
  frame: HTMLElement
  table: HTMLElement
}

export function useTableFit(
  box: Readonly<Ref<HTMLElement | null>>,
  holds: readonly WatchSource[],
  rule: () => TableFitRule,
) {
  const fit = ref<TableFit>('one')
  /**
   * How wide the table is at each step where it ran past its frame, which is then the least it
   * needs, until what it holds changes. Standing in its frame it fills it, which says nothing of
   * what it needs.
   */
  let needs: Partial<Record<TableFit, number>> = {}

  /** Lays the tables out at a step and reads whether each then stands in its frame's width. */
  function stands(section: HTMLElement, tables: readonly Framed[], at: TableFit) {
    section.dataset.fit = at
    let all = true
    for (const { frame, table } of tables) {
      const width = table.offsetWidth
      if (width <= frame.clientWidth) continue
      needs[at] = Math.max(needs[at] ?? 0, width)
      all = false
    }
    return all
  }

  /** Whether a step runs past a frame for certain: it needs more than the frame's whole width. */
  const past = (tables: readonly Framed[], at: TableFit) =>
    tables.some(({ frame }) => (needs[at] ?? 0) > frame.offsetWidth)

  function measure() {
    const section = box.value
    if (!section) return
    const tables = [...section.querySelectorAll<HTMLElement>('.chart-table-frame')].flatMap(
      (frame) => {
        const table = frame.querySelector('table')
        return table ? [{ frame, table }] : []
      },
    )
    if (!tables.length) return
    const { steps, otherwise } = rule()
    // Set on the element as well as bound, so each measure reads its step now and the answer
    // stands on it before the next frame, whatever the binding does in between.
    fit.value = steps.find((at) => !past(tables, at) && stands(section, tables, at)) ?? otherwise
    section.dataset.fit = fit.value
  }

  /** Reads every step again: what the table holds changed, or the type it is set in. */
  function remeasure() {
    needs = {}
    measure()
  }

  useResizeObserver(box, measure)
  useEventListener(document.fonts, 'loadingdone', remeasure)
  watch([...holds], remeasure, { flush: 'post' })

  return fit
}
