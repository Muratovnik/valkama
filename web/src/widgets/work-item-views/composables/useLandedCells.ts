/**
 * The terminal cells a move has landed in. A card dropped into Done is drawn in
 * Done rather than hidden behind a count that just changed, so the cell it went
 * to opens. Keyed by lane and state: a landing opens that cell of that lane only.
 */
import { reactive } from 'vue'

import type { BoardLane } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkflowState } from '@/shared/api/planningModel.ts'

const key = (lane: BoardLane, state: WorkflowState) => `${lane.id}:${state.state_id}`

export function useLandedCells(states: () => readonly WorkflowState[]) {
  const landed = reactive(new Set<string>())

  return {
    isLanded: (lane: BoardLane, state: WorkflowState) => landed.has(key(lane, state)),
    /** A move into a terminal state opens that cell of the lane the move was made in. */
    land(lane: BoardLane, move: BoardMove) {
      const target = states().find((state) => state.key === move.state)
      if (target?.is_terminal) landed.add(key(lane, target))
    },
  }
}
