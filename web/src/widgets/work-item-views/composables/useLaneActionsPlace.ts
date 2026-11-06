/**
 * Where a lane heading's actions stand: at the end of the heading's last line
 * when that line has room for them, or at the end of its first line, beside the
 * title, when it has not.
 *
 * The end of the last line keeps the title whole, which on a phone is most of
 * what the first line holds; the first line is where they go when the last is
 * full, rather than onto a line of their own. Which line has room is a fact of
 * the drawn lines, so it is read from them: the heading lays out a place of the
 * actions' width last in its lines either way — the actions themselves, or an
 * empty place of the same width when they stand beside the title — and the place
 * is either on the same line as what comes before it or not. The lines do not
 * depend on where the actions stand, so the answer cannot flip back and forth.
 */
import { onMounted, ref, watch } from 'vue'
import type { Ref, WatchSource } from 'vue'

import { useResizeObserver } from '@vueuse/core'

/** A box's vertical middle: two parts on one line share it, whatever their heights. */
function middle(box: DOMRect): number {
  return (box.top + box.bottom) / 2
}

export function useLaneActionsPlace(
  tail: Ref<HTMLElement | null>,
  actions: Ref<HTMLElement | null>,
  room: Ref<HTMLElement | null>,
  content: WatchSource,
) {
  /** The last line has no room: the actions stand at the end of the first. */
  const crowded = ref(false)

  function read() {
    const place = crowded.value ? room.value : actions.value
    if (!tail.value || !place) return
    const parts = [...tail.value.children].filter(
      (part) =>
        part !== actions.value &&
        part !== room.value &&
        getComputedStyle(part).position !== 'absolute',
    )
    const before = parts.at(-1)
    if (!before) return
    const shared =
      Math.abs(middle(place.getBoundingClientRect()) - middle(before.getBoundingClientRect())) <= 1
    crowded.value = !shared
  }

  useResizeObserver(tail, read)
  watch(content, read, { flush: 'post' })
  onMounted(read)

  return { crowded }
}
