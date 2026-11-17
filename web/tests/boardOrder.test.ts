/**
 * A move drawn before the server answers it: the one fact the server is sent,
 * the state, applied to the items the board last read, the item last there.
 */
import { describe, expect, it } from 'vitest'

import { newestClosedFirst, placeLocally } from '@/widgets/work-item-views/utils/boardOrder.ts'

import { boardItem, boardWorkflow, references } from './fixtures/board.ts'

const space = [
  boardItem(1),
  boardItem(2),
  boardItem(3),
  boardItem(10, 'todo'),
  boardItem(11, 'todo'),
  boardItem(20, 'dev'),
]

/** An accepted open goal: it stands in no state and derives one from its work. */
const goal = (n: number) =>
  boardItem(n, 'backlog', {
    kind: 'goal',
    state: null,
    container_state: 'in_progress',
    workable: false,
  })

describe('a move drawn on the board', () => {
  it('moves into another state, last there, and takes that state', () => {
    const last = placeLocally(space, boardWorkflow, { reference: 'MAIN-2', state: 'todo' })
    expect(references(last)).toEqual([
      'MAIN-1',
      'MAIN-3',
      'MAIN-10',
      'MAIN-11',
      'MAIN-2',
      'MAIN-20',
    ])
    expect(last.find((item) => item.reference === 'MAIN-2')?.state?.key).toBe('todo')
    // Into a state that holds nothing yet.
    const empty = placeLocally(space, boardWorkflow, { reference: 'MAIN-1', state: 'done' })
    expect(references(empty).at(-1)).toBe('MAIN-1')
  })

  it('keeps the accepted open goals, which stand in no state, after the states and in their order', () => {
    const withGoals = [goal(30), ...space, goal(31)]
    const moved = placeLocally(withGoals, boardWorkflow, { reference: 'MAIN-1', state: 'todo' })
    expect(references(moved)).toEqual([
      'MAIN-2',
      'MAIN-3',
      'MAIN-10',
      'MAIN-11',
      'MAIN-1',
      'MAIN-20',
      'MAIN-30',
      'MAIN-31',
    ])
  })

  it('closes an item moved into a finishing state and opens one moved out of it', () => {
    const closed = placeLocally(space, boardWorkflow, { reference: 'MAIN-1', state: 'done' })
    expect(closed.find((item) => item.reference === 'MAIN-1')?.open).toBe(false)
    const done = [boardItem(40, 'done'), ...space]
    const opened = placeLocally(done, boardWorkflow, { reference: 'MAIN-40', state: 'dev' })
    expect(opened.find((item) => item.reference === 'MAIN-40')?.open).toBe(true)
  })

  it('draws nothing for an item or a state the board does not know', () => {
    expect(
      references(placeLocally(space, boardWorkflow, { reference: 'MAIN-99', state: 'todo' })),
    ).toEqual(references(space))
    expect(
      references(placeLocally(space, boardWorkflow, { reference: 'MAIN-1', state: 'review' })),
    ).toEqual(references(space))
  })
})

describe('the order the board draws finished work in', () => {
  const done = (n: number, closed_at: string | null) => boardItem(n, 'done', { closed_at })
  const mixed = [
    boardItem(1),
    done(30, '2026-10-01T09:00:00Z'),
    boardItem(2),
    done(31, '2026-10-30T09:00:00Z'),
    done(32, '2026-10-15T09:00:00Z'),
    boardItem(10, 'todo'),
  ]

  it('stands Done newest closed first and leaves every other item where it was', () => {
    expect(references(newestClosedFirst(mixed))).toEqual([
      'MAIN-1',
      'MAIN-31',
      'MAIN-2',
      'MAIN-32',
      'MAIN-30',
      'MAIN-10',
    ])
  })

  it('puts an item the board has just closed itself on top, and breaks a tie by number', () => {
    const moved = placeLocally(mixed, boardWorkflow, { reference: 'MAIN-2', state: 'done' })
    const drawn = newestClosedFirst(moved).filter((item) => item.state?.key === 'done')
    expect(references(drawn)).toEqual(['MAIN-2', 'MAIN-31', 'MAIN-32', 'MAIN-30'])
    const tied = [done(40, '2026-10-30T09:00:00Z'), done(41, '2026-10-30T09:00:00Z')]
    expect(references(newestClosedFirst(tied))).toEqual(['MAIN-41', 'MAIN-40'])
  })
})
