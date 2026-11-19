/**
 * The form the Analytics bar takes for its room: a phone's rows, the two rows of a narrow bar or
 * one line, and what that line gave up to fit (`useBarRoom`): its buttons' words, the room between
 * its parts, the word around the age, a failure's retry's own word, and a span's name, in that
 * order. A bar wider than a phone and under 50rem has no room for the one line whatever period is
 * chosen, so it is two rows from the start.
 *
 * Widths are counted in the root's ems, as the bar's container queries count them, so what the
 * bar decides here and what its styles decide agree.
 */
import type { Ref, WatchSource } from 'vue'
import { computed } from 'vue'

import { useElementSize } from '@vueuse/core'

import { useBarRoom } from '@/pages/analytics/composables/useBarRoom.ts'

/** A width in the root's ems, as the bar's container queries count it. */
function ems(width: number) {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  return width / rem
}

export function useBarForm(options: {
  /** The bar, whose width is the one its container queries read. */
  bar: Readonly<Ref<HTMLElement | null>>
  /** What else changes what the line holds (`useBarRoom`). */
  holds: WatchSource[]
  /** The line, whose end nothing on it may pass. */
  line: Readonly<Ref<HTMLElement | null>>
  /** What stands last on the line, at its end. */
  last: () => HTMLElement | null | undefined
}) {
  const { line } = options
  const room = useBarRoom({
    line,
    last: options.last,
    // On a phone the failure's words wrap rather than run past the row's end, a last resort.
    wrapped: () => {
      const words = line.value?.querySelector<HTMLElement>('.refresh-failed-words')
      if (!words) return false
      const size = Number.parseFloat(getComputedStyle(words).fontSize)
      return words.getBoundingClientRect().height > 1.9 * size
    },
    order: () => ['words', 'gaps', 'ago', 'retry', 'span'],
    observed: [line],
    // Wider than a phone and under 50rem the one line has no room whatever period is chosen.
    narrow: () => {
      const wide = ems(line.value?.getBoundingClientRect().width ?? 0)
      return wide > 30 && wide < 50
    },
    holds: options.holds,
  })

  const { width } = useElementSize(options.bar)
  /** Whether the bar has a phone's rows, as its container query says (`width <= 30rem`). */
  const phone = computed(() => {
    const wide = ems(width.value)
    return wide > 0 && wide <= 30
  })

  return {
    phone,
    /** Whether the bar says its buttons by their icons: on a phone, or on a line that gave up their words. */
    short: computed(() => phone.value || room.gave('words')),
    /** Whether the room between the parts narrowed. */
    tight: computed(() => room.gave('gaps')),
    /** Whether the age is said by its span alone, «15 s», its hint and hidden words saying «ago». */
    bare: computed(() => room.gave('ago')),
    /** Whether a failure's words are its retry. */
    brief: computed(() => room.gave('retry')),
    /** Whether a span's name is cut at its end. */
    spanCut: computed(() => room.gave('span')),
    /** Whether the bar is two rows: too narrow for one line, or with no room for it after all. */
    twoRows: room.rows,
    /** Whether the line is being fitted, a failure holding its room unseen. */
    held: room.holding,
  }
}
