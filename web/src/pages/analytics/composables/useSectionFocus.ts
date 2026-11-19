/**
 * Where the focus goes as the Analytics page's sections take turns (`AnalyticsView`).
 *
 * - A section opened from an overview card's heading (`openFromCard`). The heading goes with the
 *   overview, and the focus with it to the page, so beside the rail it moves to the section's
 *   panel, which the section names; in place of the list it moves to the way back, as any section
 *   chosen there does.
 * - Back on the overview the focus returns to the heading of the card that opened the section,
 *   once it is drawn, unless the reader has taken it out of the panel since: to a tile of the rail,
 *   say, which the overview was chosen from.
 * - As the list and a section take turns on a narrow page, the focus goes to the way back, or to
 *   the section left. Only a move between them does that; the page found too narrow on opening or
 *   on a resize moves none.
 */
import { nextTick, watch } from 'vue'
import type { Ref } from 'vue'

import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import { focusOnNothing } from '@/shared/lib/focusRight.ts'
import { moveFocus } from '@/shared/lib/moveFocus.ts'

export function useSectionFocus(options: {
  /** The panel that shows the section on show. */
  panel: Readonly<Ref<HTMLElement | null>>
  /** The way back to the list, where a section stands in its place. */
  back: () => HTMLElement | undefined
  /** Chooses a section, as the rail does. */
  choose: (dimension: UsageDimension) => void
  /** What the panel shows, which a card's heading is drawn with. */
  drawn: () => unknown
  /** Gives the focus to the section on show in the list. */
  focusList: () => void
  /** Whether the list and a section take turns. */
  narrow: () => boolean
  /** Whether a section stands in place of the list. */
  open: () => boolean
  overview: () => boolean
}) {
  /** The overview card whose heading opened the section on show, given focus back on return. */
  let openedFrom: UsageDimension | null = null

  function openFromCard(dimension: UsageDimension) {
    openedFrom = dimension
    options.choose(dimension)
    if (!options.narrow()) moveFocus(options.panel.value)
  }

  watch(
    [options.overview, options.drawn],
    () => {
      const card = openedFrom
      if (!options.overview() || !card) return
      const panel = options.panel.value
      const heading = panel?.querySelector<HTMLElement>(`[data-card="${card}"] .overview-top-open`)
      if (!heading) return
      openedFrom = null
      if (focusOnNothing() || panel?.contains(document.activeElement)) heading.focus()
    },
    { flush: 'post' },
  )

  watch(options.open, async (opened, was) => {
    if (opened === was || !options.narrow()) return
    await nextTick()
    if (opened) options.back()?.focus()
    else options.focusList()
  })

  return { openFromCard }
}
