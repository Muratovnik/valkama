import { nextTick, ref, watch } from 'vue'
import type { WatchSource } from 'vue'

import { useEventListener } from '@vueuse/core'

/** The air the menu keeps from the window's foot and end: `--space-2`, its shadow's first step. */
const FOOT_AIR = 8

/**
 * How tall a filter's menu may stand (`FacetFilter`): from where it starts to the window's foot. It offers
 * more than any window holds on a real space, and at a fixed height it hid most of that with
 * half a tall window left over. It is read as the menu opens, when the window changes and when
 * the bar over the menu changes height; nothing else moves where it starts.
 *
 * How wide it may stand is read with it: from where it starts to the window's end, so a menu wider
 * than the field it opens under, near the window's end, never runs past it.
 */
export function useMenuRoom(
  menu: () => HTMLElement | null | undefined,
  shown: () => boolean,
  bar: WatchSource,
) {
  const room = ref<string>()
  const across = ref<string>()
  function measure() {
    const box = menu()?.getBoundingClientRect()
    if (!box || !shown()) return
    room.value = `${Math.max(0, window.innerHeight - box.top - FOOT_AIR)}px`
    across.value = `${Math.max(0, document.documentElement.clientWidth - box.left - FOOT_AIR)}px`
  }
  // After the flush: until `v-show` has had its turn in it, a menu opening has no box to read.
  watch([shown, bar], () => void nextTick(measure))
  useEventListener(window, 'resize', measure)
  return { across, room }
}
