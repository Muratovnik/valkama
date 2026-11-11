/**
 * Whether the page has room for its rail and its panel side by side, measured on the page's own
 * box rather than on the window: the shell's navigation and an open drawer take their share of a
 * window, and only what the page is given decides.
 *
 * The panel beside the rail must be at least `PANEL_LEAST` wide. Narrower, its charts opened as
 * their tables — at a window 1024 pixels wide the panel was 473 — so the page shows the list of
 * sections and a section in turn instead. The rail's own width is set here too (`railWidth`), so
 * the measure and the layout cannot disagree about it.
 *
 * The page is measured as it is mounted, so it never shows a frame of the other layout, and
 * again whenever its box changes. Until then it counts as wide, the way it opens on a desktop; a
 * box measured at nothing, as a hidden page's is, decides nothing.
 */
import type { Ref } from 'vue'
import { computed, onMounted, ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

/** The rail's width beside the panel, in the root's ems. */
const RAIL_EMS = 15

/** The least width of the panel beside the rail, in pixels. */
const PANEL_LEAST = 640

export function usePanelRoom(page: Ref<HTMLElement | null>) {
  /** The page's width and the root's font size when it was last measured. */
  const measured = ref<{ em: number; width: number } | null>(null)
  function measure(width: number | undefined) {
    if (!width) return
    const em = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    measured.value = { width, em: Number.isFinite(em) ? em : 16 }
  }
  onMounted(() => measure(page.value?.getBoundingClientRect().width))
  useResizeObserver(page, ([entry]) => measure(entry?.contentRect.width))
  const narrow = computed(() => {
    const room = measured.value
    return room !== null && room.width - RAIL_EMS * room.em < PANEL_LEAST
  })
  return { narrow, railWidth: `${RAIL_EMS}rem` }
}
