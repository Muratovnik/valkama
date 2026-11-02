import type { ChainScope } from '@/shared/api/planningChainApi.ts'
import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'

/** Which of a chain's member groups are opened past their first rows, and whether Done is unfolded. */
export interface MembersView {
  doneOpen: boolean
  expanded: ChainGroup[]
}

/** How a card's chain section was being read: its scope, the lane chosen on the map, its open groups. */
export interface ChainView extends MembersView {
  lane: string | null
  scope: ChainScope
}

/**
 * Where a card was left when another card was opened from it, so Back brings
 * the reader to the same place rather than to the top of the parent.
 *
 * The page's trail holds it, beside the reference it already holds, because the
 * card is a new instance for every item and keeps nothing across the trip; the
 * card alone reads it and applies it.
 */
export interface InspectorReturn {
  /** The chain section's own reading, where the card has one. */
  chain: ChainView | null
  /** The card that was opened from here, whose row takes focus on the way back. */
  opened: string
  /** The card to come back to. */
  reference: string
  /** How far the card was read. */
  scroll: number
  /** The section that was shown. */
  section: string
}
