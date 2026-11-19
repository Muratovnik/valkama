/**
 * How many chips of a row, from the first, its room has space for; the rest are counted on a
 * button beside it («Filters: N»), which takes room of its own while it shows, less what its
 * neighbours give up while it does (`freed`).
 *
 * Each chip is measured in a copy of the whole row nobody sees (`measure`: every chip, each by its
 * `data-filter-chip`, and a copy of the count's button, by its `data-filter-count`), so the room a
 * chip would take is known before it is shown; the
 * count follows the room and the chips' names as either changes. It is reckoned from the room the
 * chips would have with no count beside them, which is the same whether the count shows or not,
 * so showing the count never changes the answer and it settles at once.
 *
 * Before the first measure, and where nothing is laid out, every chip shows.
 */
import type { Ref } from 'vue'
import { computed, ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

/** The gap a flex row leaves between its items, in pixels. */
const columnGap = (row: Element) => Number.parseFloat(getComputedStyle(row).columnGap) || 0

export function useChipRoom<Chip>(options: {
  chips: Readonly<Ref<readonly Chip[]>>
  /** The copy of every chip and of the count, where they are measured. */
  measure: Readonly<Ref<HTMLElement | null>>
  /** The room the shown chips stand in, a flex row whose gap parts it from the count. */
  room: Readonly<Ref<HTMLElement | null>>
  /** How much narrower the row's neighbours stand while the count shows. */
  freed: () => number
}) {
  const fit = ref(Number.POSITIVE_INFINITY)
  const shown = computed(() => options.chips.value.slice(0, fit.value))
  const folded = computed(() => shown.value.length < options.chips.value.length)

  function measureRoom() {
    const room = options.room.value
    const measure = options.measure.value
    if (!room || !measure) return
    const chips = [...measure.querySelectorAll('[data-filter-chip]')]
    const widths = chips.map((chip) => chip.getBoundingClientRect().width)
    const counter = measure.querySelector('[data-filter-count]')
    const gap = columnGap(room)
    // The chips stand parted by their own list's gap, the count by the room's.
    const between = chips[0]?.parentElement ? columnGap(chips[0].parentElement) : gap
    const counted = (counter?.getBoundingClientRect().width ?? 0) + gap - options.freed()
    const across = (count: number) =>
      widths.slice(0, count).reduce((sum, width) => sum + width, 0) +
      between * Math.max(0, count - 1)
    // The room the chips would have with no count beside them, whichever shows now.
    const whole = room.getBoundingClientRect().width + (folded.value ? counted : 0)
    let count = widths.length
    // Not all of them fit: the count shows, so at least one is counted rather than shown, even
    // where what its neighbours give up beside it leaves more room than it takes.
    if (across(count) > whole + 0.5) {
      count -= 1
      while (count > 0 && across(count) > whole - counted + 0.5) count -= 1
    }
    fit.value = count
  }
  useResizeObserver(options.room, measureRoom)
  useResizeObserver(options.measure, measureRoom)

  return { folded, shown }
}
