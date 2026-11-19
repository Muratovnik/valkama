/**
 * What the Analytics bar's line gives up, in turn, while it has no room for all it holds: each
 * part is given up only once the line, with every part before it given up, still runs past its
 * end. The line is laid out with nothing given up first and given up part by part until it fits,
 * whenever its room or what it holds changes, so a part comes back as soon as there is room for it.
 * That happens between two frames, so no frame shows a line that runs past its end.
 *
 * The last thing given up is the one line itself: a line that runs past its end with every part
 * given up becomes two rows (`rows`), as a bar too narrow for one line always is (`narrow`), and
 * those rows give way again from nothing given up, since the second row has the room the first
 * one lacked.
 * The rows change the bar's height inside the browser's measuring of sizes when a resize asked
 * for them; the page's own box, shallower and measured in the same turn, is what lets the browser
 * tell the bar's new height in that frame rather than report a loop.
 *
 * The last part on the line stands at its end; the line runs past it when that part does.
 *
 * News the line may come to say — a refresh that failed — is held while it is fitted (`holding`):
 * drawn by nobody, it takes its room, so the line gives up for it what it would give up once it is
 * said. When it is said, it takes only the room the line left (the filter's field past its words),
 * and nothing else on the line moves.
 */
import type { Ref, WatchSource } from 'vue'
import { computed, nextTick, ref, watch } from 'vue'

import { useResizeObserver } from '@vueuse/core'

/**
 * A part the bar's line can give up: the words a short bar drops from its buttons, the room
 * between its parts down to a narrow gap, the word around the age («ago»), each of which a screen
 * reader still hears, a failure's own retry's word, its words then the retry, or
 * the whole of a span's name, cut at its end with its hint saying it whole.
 */
export type BarPart = 'ago' | 'gaps' | 'retry' | 'span' | 'words'

export function useBarRoom(options: {
  /** What else changes what the line holds, read again once it has been drawn. */
  holds: WatchSource[]
  /** The line, whose end nothing on it may pass. */
  line: Readonly<Ref<HTMLElement | null>>
  /** Boxes whose size changing changes what the line needs: the line's own, a count's. */
  observed: Readonly<Ref<HTMLElement | null>>[]
  /** What stands last on the line, at its end. */
  last: () => HTMLElement | null | undefined
  /** Whether the bar is two rows whatever it holds, read as the line is fitted. */
  narrow: () => boolean
  /** The order the parts give way in. */
  order: () => readonly BarPart[]
  /** Whether words that may wrap on the line, short of room, took a second line to stand in. */
  wrapped?: () => boolean
}) {
  /** How many parts of `order` are given up. */
  const given = ref(0)
  const yielded = computed(() => new Set(options.order().slice(0, given.value)))
  /** Whether the line gave itself up for two rows. */
  const rows = ref(false)
  /** Whether the line is being fitted, the news it may come to say holding its room. */
  const holding = ref(false)

  function overruns() {
    const end = options.line.value?.getBoundingClientRect().right
    const last = options.last()?.getBoundingClientRect().right
    // Half a pixel either way is rounding, not a part drawn past the end.
    const past = end !== undefined && last !== undefined && last > end + 0.5
    return past || (options.wrapped?.() ?? false)
  }

  /** The newest fit asked for; an older one still under way stops when it sees a newer. */
  let asked = 0

  /**
   * Lays the line out on two rows or one with nothing given up, then gives parts up until it
   * fits; whether it still runs past its end with all of them given up.
   */
  async function giveWay(run: number, wrapped: boolean) {
    rows.value = wrapped
    given.value = 0
    await nextTick()
    while (run === asked && given.value < options.order().length && overruns()) {
      given.value += 1
      await nextTick()
    }
    return run === asked && overruns()
  }

  /** Fits the line on one row while that can hold it, and on two once it cannot. */
  async function fit() {
    const run = (asked += 1)
    holding.value = true
    if (options.narrow() || (await giveWay(run, false))) await giveWay(run, true)
    if (run === asked) holding.value = false
  }

  for (const box of options.observed) useResizeObserver(box, () => void fit())
  watch([...options.holds, options.order], () => void fit(), { flush: 'post' })

  return {
    /** Whether the line has given up `part`. */
    gave: (part: BarPart) => yielded.value.has(part),
    /** Whether the bar is two rows: a narrow one, or a line that gave itself up, its last part. */
    rows: computed(() => rows.value),
    /** Whether the line is being fitted: the news it may come to say takes its room, unseen. */
    holding: computed(() => holding.value),
  }
}
