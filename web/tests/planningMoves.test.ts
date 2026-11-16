/**
 * Moves sent from the board: which write each one is, the revision it names,
 * and what the board draws while they are on their way.
 */
import { shallowRef } from 'vue'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePlanningMoves } from '@/pages/planning/composables/usePlanningMoves.ts'

import { transitionWorkItem } from '@/shared/api/planningApi.ts'
import type { PlanningReadModel, WorkItem } from '@/shared/api/planningModel.ts'

import { boardItem, boardState, boardWorkflow, references } from './fixtures/board.ts'
import type { BoardStateKey } from './fixtures/board.ts'
import { deferred, workItemFixture } from './fixtures/workItem.ts'

vi.mock('@/shared/api/planningApi.ts', () => ({
  transitionWorkItem: vi.fn(),
}))
const transition = vi.mocked(transitionWorkItem)

function readModel(): PlanningReadModel {
  return {
    interface_version: 'valkama-planning-read-model',
    planning_spaces: [],
    planning_space: null,
    workflow: boardWorkflow,
    work_items: [boardItem(1), boardItem(2), boardItem(3), boardItem(10, 'todo')],
    links: [],
    stale_claims: [],
  }
}

function answer(revision: number, state: BoardStateKey = 'backlog'): WorkItem {
  return { ...workItemFixture('moved', revision), state: boardState(state) }
}

function setUp(unwritable: string | null = null) {
  const model = shallowRef(readModel())
  const notice = vi.fn<(message: string) => void>()
  const read = deferred<void>()
  const reload = vi.fn(() => read.promise)
  const moves = usePlanningMoves({ model, notice, reload, unwritable: () => unwritable })
  return { model, moves, notice, read, reload }
}

const drawn = (moves: ReturnType<typeof setUp>['moves']) =>
  references(moves.model.value?.work_items ?? [])

afterEach(() => vi.resetAllMocks())

describe('a move from the board', () => {
  it('is a transition naming only the state, drawn last there until the next read', async () => {
    transition.mockResolvedValue(answer(2, 'todo'))
    const { moves, read, reload } = setUp()
    moves.place({ reference: 'MAIN-1', state: 'todo' })
    expect(drawn(moves)).toEqual(['MAIN-2', 'MAIN-3', 'MAIN-10', 'MAIN-1'])
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(transition).toHaveBeenCalledWith({ id: 'MAIN-1', state: 'todo', expected_revision: 1 })
    expect(transition.mock.calls[0][0]).not.toHaveProperty('rank')
    // Still drawn while the read is in flight, gone once it has landed.
    expect(drawn(moves)).toEqual(['MAIN-2', 'MAIN-3', 'MAIN-10', 'MAIN-1'])
    read.resolve()
    await vi.waitFor(() => expect(drawn(moves)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-10']))
  })

  it('sends nothing for a move to the state the item already stands in', async () => {
    const { moves, read, reload } = setUp()
    moves.place({ reference: 'MAIN-3', state: 'backlog' })
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    read.resolve()
    expect(transition).not.toHaveBeenCalled()
  })

  it('sends two moves of one item one after another, the second at the revision the first named', async () => {
    const first = deferred<WorkItem>()
    transition.mockReturnValueOnce(first.promise).mockResolvedValueOnce(answer(3, 'dev'))
    const { moves, reload } = setUp()
    moves.place({ reference: 'MAIN-1', state: 'todo' })
    moves.place({ reference: 'MAIN-1', state: 'dev' })
    expect(drawn(moves)).toEqual(['MAIN-2', 'MAIN-3', 'MAIN-10', 'MAIN-1'])
    await vi.waitFor(() => expect(transition).toHaveBeenCalledOnce())
    first.resolve(answer(2, 'todo'))
    await vi.waitFor(() => expect(transition).toHaveBeenCalledTimes(2))
    expect(transition.mock.calls[1][0]).toEqual({
      id: 'MAIN-1',
      state: 'dev',
      expected_revision: 2,
    })
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
  })

  it('stops the moves still waiting when one is refused, and says why', async () => {
    transition.mockRejectedValueOnce(new Error('work item is at revision 4, not 1'))
    const { moves, notice, reload } = setUp()
    moves.place({ reference: 'MAIN-1', state: 'todo' })
    moves.place({ reference: 'MAIN-2', state: 'todo' })
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce())
    expect(notice).toHaveBeenCalledWith('work item is at revision 4, not 1')
    expect(transition).toHaveBeenCalledOnce()
  })

  it('is neither drawn nor sent where nothing may be written', () => {
    const { moves, notice } = setUp('Only the primary store can be written')
    moves.place({ reference: 'MAIN-3', state: 'todo' })
    expect(notice).toHaveBeenCalledWith('Only the primary store can be written')
    expect(drawn(moves)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-10'])
    expect(transition).not.toHaveBeenCalled()
  })
})
