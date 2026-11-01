/**
 * What a tile says it waits on: an open blocker, named, and never a finished
 * one — the card used to list a Done item as blocking a workable one.
 */
import { describe, expect, it } from 'vitest'

import { waitingOn } from '@/widgets/work-item-views/utils/boardWaiting.ts'

import type { PlanningEdge } from '@/shared/api/planningModel.ts'

import { boardId, boardItem } from './fixtures/board.ts'

const blocks = (from: number, to: number): PlanningEdge => ({
  from: boardId(from),
  to: boardId(to),
  kind: 'blocks',
})

describe('what an item on the board waits on', () => {
  const space = [
    boardItem(1, 'backlog'),
    boardItem(2, 'dev'),
    boardItem(3, 'done'),
    boardItem(4, 'todo'),
    boardItem(5, 'backlog'),
  ]

  it('names an open blocker by its reference', () => {
    expect(waitingOn([blocks(2, 1)], space).get(boardId(1))).toBe('MAIN-2')
  })

  it('never names a finished blocker', () => {
    expect(waitingOn([blocks(3, 1)], space).has(boardId(1))).toBe(false)
  })

  it('names nothing for a link that does not block', () => {
    const relates: PlanningEdge = { from: boardId(2), to: boardId(1), kind: 'relates-to' }
    expect(waitingOn([relates], space).size).toBe(0)
  })

  it('names nothing for a blocker it cannot see, rather than guessing it is open', () => {
    expect(waitingOn([blocks(99, 1)], space).size).toBe(0)
  })

  it('names the first open blocker linked, past a finished one, on every read', () => {
    const links = [blocks(3, 5), blocks(4, 5), blocks(2, 5)]
    expect(waitingOn(links, space).get(boardId(5))).toBe('MAIN-4')
    expect(waitingOn(links, space).get(boardId(5))).toBe('MAIN-4')
  })
})
