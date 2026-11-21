/**
 * How wide the list is, and so which of its columns stand (`fitFor`): the widest fit whose
 * table the list's own box holds, not the window's, since a panel beside it takes some of
 * the window.
 *
 * A fit holds where its table is no wider than the list. The table is as wide as its
 * columns need — each as wide as its widest row and its heading, a tree's first column
 * with its lead, the title its 36 characters with its heading on one line, all of which
 * the list's styles declare — and so a fit that does not hold pushes it past the list,
 * and gives way to the next, drawn at once. How far past is what that fit needs, kept so
 * a list that grows again stands it only where it holds. Fixed widths decided before and
 * held for the words they were measured with: a migrated store's longer states, holders
 * and dates left a flat list 946px wide its title 172px and its heading two lines.
 *
 * A fit is tried and given up within one frame: the table is read after each drawing and
 * before the browser paints, so a reader sees only the fit that holds. A new width, a new
 * language or a new order tries every wider fit again; new rows only give way, since they
 * come with every change of the space and trying each wider fit again would draw the rows
 * up to three more times for each.
 *
 * The rows are drawn once the list knows its own width (`measured`). Drawn before, a phone
 * drew a thousand rows with every column and at once drew them all again with the columns
 * folded, which doubled what opening the list cost there.
 */
import { computed, onMounted, ref, watch } from 'vue'
import type { Ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import { fitFor } from '@/widgets/work-item-views/utils/listColumns.ts'
import type { Fit } from '@/widgets/work-item-views/utils/listColumns.ts'

/** A table this much wider than its list is a rounding of the columns, not a fit that fails. */
const ROUNDING = 1

/**
 * `rows` and `order` are what the table is drawn from: the rows, which a change of the
 * space brings, and what every wider fit is tried again for, the language and the order.
 */
export function useListFit(
  root: Ref<HTMLElement | null>,
  { order, rows }: { order: () => unknown; rows: () => unknown },
) {
  const width = ref(0)
  const measured = ref(false)
  const fit = ref<Fit>('full')
  /** What each fit's table needed where the list did not hold it, for the rows of `drawing`. */
  const needs = new Map<Fit, { drawing: number; need: number }>()
  let drawing = 0
  /** Whether wider fits are tried: after a new width, language or order, not after new rows. */
  let widening = true

  function settle() {
    const list = root.value
    const table = list?.querySelector('table')
    if (!list || !table || !measured.value) return
    const room = list.clientWidth
    const drawn = table.getBoundingClientRect().width
    if (drawn > room + ROUNDING) needs.set(fit.value, { drawing, need: drawn })
    else needs.delete(fit.value)
    const known = new Map<Fit, number>()
    for (const [each, { drawing: at, need }] of needs) if (at === drawing) known.set(each, need)
    fit.value = fitFor(room, known, widening ? 'full' : fit.value)
  }

  useResizeObserver(root, ([entry]) => {
    width.value = entry.contentRect.width
    widening = true
    settle()
  })
  watch(measured, settle, { flush: 'post' })
  watch(fit, settle, { flush: 'post' })
  onMounted(() => {
    width.value = root.value?.clientWidth ?? 0
    measured.value = true
    // Made here, since the rows are the list's to make after its fit.
    watch(
      [rows, order],
      ([, now], [, before]) => {
        drawing += 1
        widening = now !== before
        settle()
      },
      { flush: 'post' },
    )
  })

  return {
    fit,
    measured,
    narrow: computed(() => fit.value === 'narrow'),
    width,
  }
}
