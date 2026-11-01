/**
 * The Done column as the owner reads it: what just finished first, and no
 * pretence of an order that a hand could change. A drag is the browser suite's
 * to prove; the keyboard and the drawn order are tested here.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { boardItem } from '../fixtures/board.ts'
import { board, closedEpic, tile } from '../support/workItemBoardHarness.ts'

beforeEach(() => localStorage.clear())
afterEach(() => {
  document.body.innerHTML = ''
})

/**
 * Finished work in the order a read lists it, which is the order of work and
 * so oldest first: the server keeps a moved item's old place.
 */
const finished: WorkItemBrief[] = [
  boardItem(1, 'backlog'),
  boardItem(20, 'done', { parent_id: closedEpic.work_item_id, closed_at: '2026-10-02T09:00:00Z' }),
  boardItem(21, 'done', { parent_id: closedEpic.work_item_id, closed_at: '2026-10-31T09:00:00Z' }),
  boardItem(22, 'done', { parent_id: closedEpic.work_item_id, closed_at: '2026-10-20T09:00:00Z' }),
  { ...closedEpic, closed_at: '2026-09-01T09:00:00Z' },
]

const doneTiles = (wrapper: ReturnType<typeof board>) =>
  wrapper
    .findAll('ul[data-state="done"] li[data-reference]')
    .map((node) => node.attributes('data-reference'))

describe('the Done column', () => {
  it('stands the most recently closed first, flat and in an epic’s lane', async () => {
    const flat = board({ items: finished, spaceItems: finished })
    expect(doneTiles(flat)).toEqual(['MAIN-21', 'MAIN-22', 'MAIN-20', 'MAIN-2'])

    const grouped = board({ items: finished, spaceItems: finished, grouping: 'epic' })
    // A lane with nothing open is folded, and its Done cell draws on request.
    await grouped.get('.lane-toggle[aria-expanded="false"]').trigger('click')
    await grouped.get('.lane-cell[data-state="done"] .lane-more').trigger('click')
    expect(doneTiles(grouped)).toEqual(['MAIN-21', 'MAIN-22', 'MAIN-20'])
  })

  it('offers no reorder from the keyboard there, where an open column still does', async () => {
    const wrapper = board({ items: finished, spaceItems: finished })
    const done = tile(wrapper, 'MAIN-22')
    expect(done.attributes('aria-keyshortcuts')).toBeUndefined()
    expect(done.attributes('aria-describedby')).toBeUndefined()
    for (const key of ['ArrowUp', 'ArrowDown']) await done.trigger('keydown', { key, altKey: true })
    expect(wrapper.emitted('place')).toBeUndefined()
    expect(doneTiles(wrapper)).toEqual(['MAIN-21', 'MAIN-22', 'MAIN-20', 'MAIN-2'])
    expect(tile(wrapper, 'MAIN-1').attributes('aria-keyshortcuts')).toBe(
      'Alt+ArrowUp Alt+ArrowDown',
    )
  })

  it('says its stack is ordered by closing, which a drop into it reads', () => {
    const wrapper = board({ items: finished, spaceItems: finished })
    expect(wrapper.get('ul[data-state="done"]').attributes('data-order')).toBe('closing')
    expect(wrapper.get('ul[data-state="backlog"]').attributes('data-order')).toBeUndefined()
  })
})
