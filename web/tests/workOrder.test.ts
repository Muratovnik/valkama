/**
 * The order the board and the list draw work in, and the address that keeps it: the
 * queue's by default, a column's or the filing time's, each either way round.
 */
import { describe, expect, it } from 'vitest'

import { readsSort, sortOf, withSort } from '@/pages/planning/utils/viewSortRoute.ts'

import { nextSort, orderedWork, QUEUE_ORDER } from '@/widgets/work-item-views/utils/workOrder.ts'

import { boardGoal, boardItem, references } from './fixtures/board.ts'

const stateName = (item: { state: { name: string } | null }) => item.state?.name ?? ''

describe('the queue order', () => {
  // MAIN-4 is under the goal MAIN-1 and second in the queue; MAIN-5 first; MAIN-6 and
  // MAIN-7 are not in it, listed in that order; the goal MAIN-2 holds nothing in it.
  const goal = boardGoal(1)
  const idle = boardGoal(2)
  const items = [
    boardItem(6),
    idle,
    boardItem(4, 'todo', { parent_id: goal.work_item_id, queue_order: 2 }),
    goal,
    boardItem(5, 'todo', { queue_order: 1 }),
    boardItem(7),
  ]

  it('gives what the queue gives first, then the rest as listed, then idle containers', () => {
    expect(references(orderedWork(items, QUEUE_ORDER, stateName))).toEqual([
      'MAIN-5',
      // A goal stands at the place of its earliest task in the queue, before it.
      'MAIN-1',
      'MAIN-4',
      'MAIN-6',
      'MAIN-7',
      'MAIN-2',
    ])
  })

  it('reads a container’s place over the whole scope, its task filtered away included', () => {
    const shown = items.filter((item) => item.reference !== 'MAIN-4')
    const order = orderedWork(shown, QUEUE_ORDER, stateName, items)
    expect(references(order).slice(0, 2)).toEqual(['MAIN-5', 'MAIN-1'])
  })

  it('turns the whole order over from the end', () => {
    expect(references(orderedWork(items, { key: 'queue', descending: true }, stateName))).toEqual([
      'MAIN-2',
      'MAIN-7',
      'MAIN-6',
      'MAIN-4',
      'MAIN-1',
      'MAIN-5',
    ])
  })
})

describe('the order by filing time', () => {
  const items = [
    boardItem(3, 'backlog', { created_at: '2026-10-02T10:00:00Z' }),
    boardItem(1, 'backlog', { created_at: '2026-10-03T10:00:00Z' }),
    boardItem(2, 'backlog', { created_at: '2026-10-02T10:00:00Z' }),
  ]

  it('reads the newest first or the oldest, a tie by the smaller number', () => {
    const newest = orderedWork(items, { key: 'created', descending: true }, stateName)
    expect(references(newest)).toEqual(['MAIN-1', 'MAIN-3', 'MAIN-2'])
    const oldest = orderedWork(items, { key: 'created', descending: false }, stateName)
    expect(references(oldest)).toEqual(['MAIN-2', 'MAIN-3', 'MAIN-1'])
  })
})

describe('a sort asked for', () => {
  it('turns the order over on the same key, and starts another from the end it reads first', () => {
    expect(nextSort({ key: 'updated', descending: true }, 'updated')).toEqual({
      key: 'updated',
      descending: false,
    })
    expect(nextSort(QUEUE_ORDER, 'priority')).toEqual({ key: 'priority', descending: true })
    expect(nextSort(QUEUE_ORDER, 'title')).toEqual({ key: 'title', descending: false })
    expect(nextSort({ key: 'title', descending: false }, 'queue')).toEqual(QUEUE_ORDER)
  })
})

describe('the order in the address', () => {
  it('reads no key as the queue’s order from the start', () => {
    expect(sortOf({})).toEqual(QUEUE_ORDER)
    expect(sortOf(undefined)).toEqual(QUEUE_ORDER)
    expect(sortOf({ desc: true })).toEqual({ key: 'queue', descending: true })
  })

  it('reads a known key with its direction, and an unknown one as the default', () => {
    expect(sortOf({ sort: 'created', desc: true })).toEqual({ key: 'created', descending: true })
    expect(sortOf({ sort: 'former', desc: true })).toEqual(QUEUE_ORDER)
    expect(readsSort({ sort: 'former' })).toBe(false)
    expect(readsSort({ desc: 'yes' })).toBe(false)
    expect(readsSort({ sort: 'updated', desc: true })).toBe(true)
  })

  it('writes the defaults as no keys, and keeps every other key', () => {
    expect(withSort({ view: 'list', sort: 'title', desc: true }, QUEUE_ORDER)).toEqual({
      view: 'list',
    })
    const written = withSort({ view: 'list' }, { key: 'updated', descending: true })
    expect(written).toEqual({ view: 'list', sort: 'updated', desc: true })
    expect(sortOf(written)).toEqual({ key: 'updated', descending: true })
  })
})
