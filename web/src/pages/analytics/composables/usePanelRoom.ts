/**
 * Whether the page has room for its rail and its panel side by side, measured on the page's own
 * box rather than on the window: the shell's navigation and an open drawer take their share of a
 * window, and only what the page is given decides.
 *
 * The panel beside the rail must be at least `PANEL_LEAST` wide. Narrower, its charts opened as
 * their tables — at a window 1024 pixels wide the panel was 473 — so the page shows the list of
 * sections and a section in turn instead.
 *
 * The rail is as wide as its entries need, within a range its own style sets, so its width is
 * read off the rail as it stands beside the panel rather than assumed: the measure and the layout
 * cannot disagree about it. Taking turns, the rail is the whole screen, or not shown at all, and
 * says nothing about its width beside the panel, so the last width it stood at there decides.
 * The page opens beside, so that width is there from the first measure.
 *
 * The page is measured as it is mounted, so it never shows a frame of the other layout, and
 * again whenever its box or the rail's changes. Until then it counts as wide, the way it opens on
 * a desktop; a box measured at nothing, as a hidden page's is, decides nothing.
 */
import type { Ref } from 'vue'
import { computed, onMounted, ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

/** The least width of the panel beside the rail, in pixels. */
const PANEL_LEAST = 640

/** The page's box, and the rail's component, whose root is the rail's box. */
export function usePanelRoom(page: Ref<HTMLElement | null>, rail: Ref<{ $el?: unknown } | null>) {
  const railBox = computed(() => {
    const root = rail.value?.$el
    return root instanceof HTMLElement ? root : null
  })
  /** The page's width when it was last measured. */
  const pageWidth = ref(0)
  /** The rail's width when it last stood beside the panel. */
  const railWidth = ref(0)

  const narrow = computed(
    () =>
      pageWidth.value > 0 && railWidth.value > 0 && pageWidth.value - railWidth.value < PANEL_LEAST,
  )

  function measurePage(width: number | undefined) {
    if (width) pageWidth.value = width
  }
  /** The rail's width counts only beside the panel, and a hidden rail's nothing never does. */
  function measureRail(width: number | undefined) {
    if (width && !narrow.value) railWidth.value = width
  }

  onMounted(() => {
    measureRail(railBox.value?.getBoundingClientRect().width)
    measurePage(page.value?.getBoundingClientRect().width)
  })
  useResizeObserver(page, ([entry]) => measurePage(entry?.contentRect.width))
  useResizeObserver(railBox, ([entry]) => measureRail(entry?.borderBoxSize[0]?.inlineSize), {
    box: 'border-box',
  })
  return { narrow }
}
