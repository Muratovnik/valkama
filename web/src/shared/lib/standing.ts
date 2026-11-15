/**
 * Where a work item stands. An item stands in a state of its workflow, except an accepted open
 * goal or stage, which stands in none and derives one from the work under it
 * (`container_state`). This is the one reading of the two; the words for it are
 * `useStandingName`'s.
 */
import type { ContainerState } from '@/shared/api/planningModel.ts'
import type { NamedState } from '@/shared/lib/stateNames.ts'

/** Where an item stands: a state, or what an accepted open goal or stage derives instead. */
export interface StandingItem {
  state: NamedState | null
  container_state?: ContainerState | null
}

/**
 * Where an item stands, as a key of the work-item-state presentation (`uiSystem`): its state's
 * category, or, for an accepted open goal or stage, which stands in no state, the state it
 * derives from the work under it. A record that says neither reads as not started, where the
 * derivation itself begins. Every surface that draws a standing — its tone, its words, its
 * mark and the value a facet reads — takes it from here, so they cannot come to disagree.
 */
export const standingOf = (item: StandingItem): string =>
  item.state?.category ?? item.container_state ?? 'not_started'
