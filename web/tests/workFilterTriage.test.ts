/**
 * The filter's condition «Awaiting triage»: a card of the space's triage stack that no review
 * has marked, as the line «time to triage» of «Needs my answer» counts them. Which cards it
 * keeps, that it keeps exactly as many as the server's line counts on the server's own answers,
 * how it rides the address, and that the planning manifest admits that address.
 */
import { describe, expect, it } from 'vitest'

import { tokenName } from '@/features/work-filter/filterOptions.ts'

import {
  addToken,
  filterRouteState,
  matchesWorkFilter,
  readWorkFilter,
  writeWorkFilter,
} from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import { validateInputRequestList } from '@/shared/api/inputRequestModel.ts'
import { validateReadModel } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import { validateManifestRouteState } from '@/shared/api/platformRoute.ts'

import { boardItem, references } from './fixtures/board.ts'
import { readServerFixture } from './support/serverFixtures.ts'
import { i18n } from './support/workItemBoardHarness.ts'

const { t } = i18n().global
const unmarked = { seen_at: null, seen_by: null }
const marked = { seen_at: '2026-11-19T09:00:00Z', seen_by: 'worker-a' }

// In the board's triage state `backlog`: MAIN-1 waits in the stack unmarked, MAIN-2 in it
// marked, and MAIN-3 stands outside the stack (the read gives it no `triage_stack`); MAIN-4 is
// ready work. MAIN-5 waits unmarked in the stack of the other space that holds it.
const space = [
  boardItem(1, 'backlog', { triage_stack: unmarked }),
  boardItem(2, 'backlog', { triage_stack: marked }),
  boardItem(3, 'backlog'),
  boardItem(4, 'todo'),
  boardItem(5, 'backlog', {
    triage_stack: unmarked,
    other_space: { key: 'ALPHA', name: 'Alpha space' },
  }),
]
const AWAITING: WorkFilter = addToken({ text: '' }, { facet: 'triage' })
const kept = (items: readonly WorkItemBrief[], filter: WorkFilter) =>
  references(items.filter((item) => matchesWorkFilter(item, filter)))

describe('«Awaiting triage»', () => {
  it('keeps the space’s own stack cards no review has marked, and nothing else', () => {
    expect(kept(space, AWAITING)).toEqual(['MAIN-1'])
    expect(tokenName({ facet: 'triage' }, t)).toBe('Awaiting triage')
  })

  it('keeps as many cards of the board as the server’s line counts for that space', () => {
    // One store's answers, read one after the other: the board of the space and its line.
    const board = validateReadModel(readServerFixture('planning-read-model.json'))
    const list = validateInputRequestList(readServerFixture('requests-triage-due.json'))
    const line = list.triage_due.find(
      (due) => due.space_ref.space_key === board.planning_space?.key,
    )
    // The fixture's stack holds two cards no review marked and one a review did.
    expect(line?.count).toBe(2)
    expect(board.work_items.filter((item) => item.triage_stack !== undefined)).toHaveLength(3)
    expect(kept(board.work_items, AWAITING)).toHaveLength(line?.count ?? -1)
  })
})

describe('the address', () => {
  it('keeps the condition across a reload, beside the others', () => {
    const filter = addToken(AWAITING, { facet: 'asked' })
    const { complete, state } = writeWorkFilter({ view: 'kanban' }, filter, 2048)
    expect(complete).toBe(true)
    expect(state).toEqual({ view: 'kanban', asked: true, triage: true })
    expect(readWorkFilter(state)).toEqual(filter)
    expect(readWorkFilter({ triage: 'yes' })).toEqual({ text: '' })
  })

  it('is one the planning manifest admits, as the link of the line writes it', () => {
    const planning = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'planning')
    if (!planning) throw new Error('no planning manifest')
    const state = filterRouteState(AWAITING)
    expect(state).toEqual({ triage: true })
    expect(validateManifestRouteState(planning, state)).toEqual({ triage: true })
  })
})
