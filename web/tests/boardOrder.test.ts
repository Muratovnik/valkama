/**
 * A move drawn before the server answers it: the same two facts the server is
 * sent, the state and where in it, applied to the items the board last read.
 */
import { describe, expect, it } from 'vitest'

import { placeLocally, rankBeside } from '@/widgets/work-item-views/utils/boardOrder.ts'

import { boardItem, boardWorkflow, references } from './fixtures/board.ts'

const space = [
  boardItem(1),
  boardItem(2),
  boardItem(3),
  boardItem(10, 'todo'),
  boardItem(11, 'todo'),
  boardItem(20, 'dev'),
]

describe('a move drawn on the board', () => {
  it('reorders inside a state exactly where the placement names', () => {
    for (const [rank, expected] of [
      ['first', ['MAIN-3', 'MAIN-1', 'MAIN-2']],
      ['last', ['MAIN-2', 'MAIN-3', 'MAIN-1']],
      ['before:MAIN-3', ['MAIN-2', 'MAIN-1', 'MAIN-3']],
      ['after:MAIN-3', ['MAIN-2', 'MAIN-3', 'MAIN-1']],
    ] as const) {
      const reference = rank === 'first' ? 'MAIN-3' : 'MAIN-1'
      const moved = placeLocally(space, boardWorkflow, { reference, state: 'backlog', rank })
      expect(references(moved).slice(0, 3), rank).toEqual(expected)
      // Every other state is untouched and still in workflow order.
      expect(references(moved).slice(3)).toEqual(['MAIN-10', 'MAIN-11', 'MAIN-20'])
    }
  })

  it('moves into another state, last unless it names a place, and takes that state', () => {
    const last = placeLocally(space, boardWorkflow, { reference: 'MAIN-2', state: 'todo' })
    expect(references(last)).toEqual([
      'MAIN-1',
      'MAIN-3',
      'MAIN-10',
      'MAIN-11',
      'MAIN-2',
      'MAIN-20',
    ])
    expect(last.find((item) => item.reference === 'MAIN-2')?.state.key).toBe('todo')
    const placed = placeLocally(space, boardWorkflow, {
      reference: 'MAIN-2',
      state: 'todo',
      rank: 'before:MAIN-11',
    })
    expect(references(placed)).toEqual([
      'MAIN-1',
      'MAIN-3',
      'MAIN-10',
      'MAIN-2',
      'MAIN-11',
      'MAIN-20',
    ])
    // Into a state that holds nothing yet.
    const empty = placeLocally(space, boardWorkflow, { reference: 'MAIN-1', state: 'done' })
    expect(references(empty).at(-1)).toBe('MAIN-1')
  })

  it('draws nothing for an item or a state the board does not know', () => {
    expect(
      references(placeLocally(space, boardWorkflow, { reference: 'MAIN-99', state: 'todo' })),
    ).toEqual(references(space))
    expect(
      references(placeLocally(space, boardWorkflow, { reference: 'MAIN-1', state: 'review' })),
    ).toEqual(references(space))
  })

  it('names a drop by the tile below it, or the one above when it landed last', () => {
    expect(rankBeside('MAIN-1', 'MAIN-2')).toBe('before:MAIN-2')
    expect(rankBeside(undefined, 'MAIN-2')).toBe('before:MAIN-2')
    expect(rankBeside('MAIN-1')).toBe('after:MAIN-1')
    expect(rankBeside()).toBeUndefined()
  })
})
