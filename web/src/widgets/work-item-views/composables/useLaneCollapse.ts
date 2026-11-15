/**
 * Which board lanes the operator folded or opened, per planning space.
 *
 * A lane starts folded when nothing in it is open, so a board of forty goals
 * opens on the dozen with work left. Only what the operator chose against that
 * is kept (`useFoldChoices`): a lane nobody touched follows its work and opens
 * again when work arrives, and a choice survives a reload.
 */
import type { BoardLane } from '@/widgets/work-item-views/utils/boardLanes.ts'

import { useFoldChoices } from '@/shared/lib/useFoldChoices.ts'

const STORAGE_KEY = 'valkama-board-lanes'

export function useLaneCollapse(space: () => string) {
  const { choices, choose } = useFoldChoices(STORAGE_KEY, space)

  /**
   * Whether a lane is folded. Under a filter a lane nobody folded shows its
   * matches, because a search that found a finished item should show it.
   */
  function folded(lane: BoardLane, filtered: boolean): boolean {
    const chosen = choices.value[lane.id]
    if (chosen !== undefined) return chosen
    return filtered ? lane.items.length === 0 : lane.open === 0
  }

  /**
   * Fold or open a lane. Outside a filter, a choice that matches what the lane's
   * work implies is forgotten, so the lane goes back to following it.
   */
  function toggle(lane: BoardLane, filtered: boolean) {
    choose(lane.id, !folded(lane, filtered), filtered ? undefined : lane.open === 0)
  }

  return { folded, toggle }
}
