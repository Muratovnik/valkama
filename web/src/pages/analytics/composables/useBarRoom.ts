/**
 * What the Analytics bar's line gives up, in turn, while it has no room for all it holds: each
 * part is given up only once the line, with every part before it given up, still runs past its
 * end. The line is laid out with nothing given up first and given up part by part until it fits,
 * whenever its room or what it holds changes, so a part comes back as soon as there is room for it.
 * That happens between two frames, so no frame shows a line that runs past its end.
 *
 * The last part on the line stands at its end; the line runs past it when that part does.
 */
import type { Ref, WatchSource } from 'vue'
import { computed, nextTick, ref, watch } from 'vue'

import { useResizeObserver } from '@vueuse/core'

/**
 * A part the bar's line can give up: the live period's mark, the words a short bar drops, the
 * room between its parts down to a narrow gap, or the failure's words, which a screen reader
 * still hears beside the disc and the retry.
 */
export type BarPart = 'failure' | 'gaps' | 'live' | 'words'

export function useBarRoom(options: {
  /** What else changes what the line holds, read again once it has been drawn. */
  holds: WatchSource[]
  /** The line, whose end nothing on it may pass. */
  line: Readonly<Ref<HTMLElement | null>>
  /** Boxes whose size changing changes what the line needs: the line's own, a count's. */
  observed: Readonly<Ref<HTMLElement | null>>[]
  /** What stands last on the line, at its end. */
  last: () => HTMLElement | null | undefined
  /** The order the parts give way in. */
  order: () => readonly BarPart[]
}) {
  /** How many parts of `order` are given up. */
  const given = ref(0)
  const yielded = computed(() => new Set(options.order().slice(0, given.value)))

  function overruns() {
    const end = options.line.value?.getBoundingClientRect().right
    const last = options.last()?.getBoundingClientRect().right
    // Half a pixel either way is rounding, not a part drawn past the end.
    return end !== undefined && last !== undefined && last > end + 0.5
  }

  /** The newest fit asked for; an older one still under way stops when it sees a newer. */
  let asked = 0
  async function fit() {
    const run = (asked += 1)
    given.value = 0
    await nextTick()
    while (run === asked && given.value < options.order().length && overruns()) {
      given.value += 1
      await nextTick()
    }
  }

  for (const box of options.observed) useResizeObserver(box, () => void fit())
  watch([...options.holds, options.order], () => void fit(), { flush: 'post' })

  /** Whether the line has given up `part`. */
  return { gave: (part: BarPart) => yielded.value.has(part) }
}
