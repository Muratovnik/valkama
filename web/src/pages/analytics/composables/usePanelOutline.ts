/**
 * Where a heading of the Analytics panel stands in the document's outline: one under the nearest
 * level around it that has a heading of its own, so the outline follows how the levels nest. The
 * panel stands under the module's name, the context bar's `h1`: a section is an `h2`, a group in
 * it an `h3`, a block an `h3` under its section or an `h4` under its group, and a heading inside a
 * block one under the block's. A level with no heading adds no step. The size is not this: it is
 * the level's (`headingLevels.css`).
 *
 * Each part named its element on its own, and a section's heading and its charts' and table's all
 * stood at `h2`, so a screen reader's list of headings read the panel as one flat row of them.
 */
import { computed, inject, provide } from 'vue'
import type { ComputedRef, InjectionKey } from 'vue'

/** The heading elements under the module's name, from the top down. */
const UNDER_MODULE = ['h2', 'h3', 'h4', 'h5', 'h6'] as const
type HeadingTag = (typeof UNDER_MODULE)[number]

/** The rank of the module's name, the heading the whole panel stands under. */
const MODULE_NAME = 1

/** The rank of the heading the parts below a level stand under. */
const OVER: InjectionKey<ComputedRef<number>> = Symbol('the heading over a part of the panel')

function rankOver(): ComputedRef<number> {
  return inject(
    OVER,
    computed(() => MODULE_NAME),
  )
}

/** The element of rank `rank`; HTML has no heading under `h6`, so a deeper one stays there. */
function tagOf(rank: number): HeadingTag {
  return UNDER_MODULE[Math.min(rank, 6) - MODULE_NAME - 1] ?? 'h6'
}

/** The element of a heading `steps` under the nearest level's heading over it. */
export function useHeadingUnder(steps = 1): ComputedRef<HeadingTag> {
  const over = rankOver()
  return computed(() => tagOf(over.value + steps))
}

/**
 * The element of a level's heading, one under the heading over the level; what the level holds
 * stands under it, or, while the level has no heading, under the heading over the level.
 */
export function useLevelHeading(headed: () => boolean): ComputedRef<HeadingTag> {
  const over = rankOver()
  provide(
    OVER,
    computed(() => (headed() ? over.value + 1 : over.value)),
  )
  return computed(() => tagOf(over.value + 1))
}

/**
 * The parts below stand under a heading of rank `rank` that is not a level's: the side panel's
 * own name, an `h2` the drawer gives it (`DrawerFrame`), which the panel's parts stand under
 * rather than under the module's name.
 */
export function provideHeadingOver(rank: number) {
  provide(
    OVER,
    computed(() => rank),
  )
}
