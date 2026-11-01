/**
 * The lane cells a move has landed in past what they draw. A card dropped or
 * moved to the fourth place of a cell that draws three is drawn there rather
 * than hidden behind a count that just changed, so the cell it went to opens.
 * Keyed by lane and state: a landing opens that cell of that lane only.
 */
import { reactive } from 'vue'

import { drawnInCell } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardLane } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkflowState } from '@/shared/api/planningModel.ts'

const key = (lane: BoardLane, state: WorkflowState) => `${lane.id}:${state.state_id}`

export function useLandedCells(states: () => readonly WorkflowState[]) {
  const landed = reactive(new Set<string>())

  return {
    isLanded: (lane: BoardLane, state: WorkflowState) => landed.has(key(lane, state)),
    /**
     * A move that lands past what its destination cell draws opens that cell of
     * the lane the move was made in. `position` counts from one, as the stack reports it.
     */
    land(lane: BoardLane, move: BoardMove, landing: { position: number }) {
      const target = states().find((state) => state.key === move.state)
      if (target !== undefined && landing.position > drawnInCell(target))
        landed.add(key(lane, target))
    },
    /** The reader closed the cell, so a landing no longer holds it open. */
    settle(lane: BoardLane, state: WorkflowState) {
      landed.delete(key(lane, state))
    },
  }
}
