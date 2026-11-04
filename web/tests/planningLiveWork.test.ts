/**
 * The read model's `live_work`: which items an agent is at work on now.
 *
 * The server sends a state per item and a time only with `quiet`, the one
 * state that says since when. A map the server cannot send is refused, and a
 * server older than the key sends none, which still reads.
 */

import { describe, expect, it } from 'vitest'

import { validateReadModel } from '@/shared/api/planningModel.ts'

import { boardId } from './fixtures/board.ts'

const emptySpace = {
  interface_version: 'valkama-planning-read-model',
  planning_spaces: [],
  planning_space: null,
  workflow: null,
  work_items: [],
  links: [],
  stale_claims: [],
}

const read = (liveWork: unknown) => () => validateReadModel({ ...emptySpace, live_work: liveWork })

describe('live work on the read model', () => {
  it('reads each state the server sends, and a quiet one with its time', () => {
    const map = {
      [boardId(1)]: { state: 'working' },
      [boardId(2)]: { state: 'waiting' },
      [boardId(3)]: { state: 'quiet', quiet_since: '2026-11-03T10:00:00Z' },
    }
    expect(read(map)().live_work).toEqual(map)
  })

  it('reads a model from a server that sends no live work', () => {
    expect(validateReadModel(emptySpace).live_work).toBeUndefined()
  })

  it.each([
    ['a quiet item without its time', { [boardId(1)]: { state: 'quiet' } }],
    [
      'a time on a state that carries none',
      { [boardId(1)]: { state: 'working', quiet_since: '2026-11-03T10:00:00Z' } },
    ],
    ['a state the server has no word for', { [boardId(1)]: { state: 'running' } }],
    ['a key that is not an item id', { 'MAIN-12': { state: 'working' } }],
    ['a quiet time that is not a time', { [boardId(1)]: { state: 'quiet', quiet_since: 'now' } }],
  ])('refuses %s', (_case, map) => {
    expect(read(map)).toThrow()
  })
})
