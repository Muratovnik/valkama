/**
 * The label room of one line of marks, measured as the line is drawn.
 *
 * The chips that might print are drawn once more, out of sight, so each one's
 * width is known whether it shows or not; the line's own width comes from a
 * resize observer. Showing fewer chips does not change the line's width, so a
 * measurement never feeds back into the next one.
 */
import { nextTick, ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import { chipsThatFit } from '@/entities/work-item/utils/labelRoom.ts'

/** What the out-of-sight copy marks, so the measurement finds it. */
export const GHOST_CHIP = 'chip'
export const GHOST_MORE = 'more'

const width = (element: Element | null) => element?.getBoundingClientRect().width ?? 0

/**
 * The room, or undefined until a line has been measured — which leaves the
 * registry's own limit in force, as a host that does not measure gets it.
 */
export function useLabelRoom(
  line: Ref<HTMLElement | null>,
  ghost: Ref<HTMLElement | null>,
  labels: WatchSource<readonly string[]>,
  enabled: () => boolean,
): Ref<number | undefined> {
  const room = ref<number | undefined>()

  function measure() {
    const row = line.value
    const sample = ghost.value
    if (!enabled() || !row || !sample) {
      room.value = undefined
      return
    }
    const chips = [...sample.querySelectorAll(`[data-ghost="${GHOST_CHIP}"]`)].map((chip) =>
      width(chip),
    )
    const total = Number(sample.dataset.total ?? chips.length)
    room.value = chipsThatFit({
      chips,
      gap: Number.parseFloat(getComputedStyle(row).columnGap) || 0,
      more: width(sample.querySelector(`[data-ghost="${GHOST_MORE}"]`)),
      line: row.clientWidth,
      total,
    })
  }

  useResizeObserver(line, measure)
  watch(labels, () => void nextTick(measure), { deep: true })
  return room
}
