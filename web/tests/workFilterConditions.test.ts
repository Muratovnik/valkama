/**
 * The filter's conditions «Waiting for my answer» and «From another space», and its
 * facets «Project» and «Goal or stage»: which items each keeps, how «≠» turns them
 * over, what the menu offers for them and how they ride the address.
 */
import { describe, expect, it } from 'vitest'

import { filterGroups, stepGroups, tokenName } from '@/features/work-filter/filterOptions.ts'

import {
  addToken,
  lineageIn,
  matchesWorkFilter,
  negateToken,
  NO_PROJECT,
  readWorkFilter,
  writeWorkFilter,
} from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import { boardGoal, boardItem, references } from './fixtures/board.ts'
import { i18n } from './support/workItemBoardHarness.ts'

const { t } = i18n().global
const project = (id: string, name: string | null = null) => ({
  project_id: id,
  display_name: name,
  source: 'named' as const,
})

// MAIN-1 a goal, MAIN-2 a stage under it, MAIN-3 a task under the stage.
const goal = boardGoal(1)
const stage = boardGoal(2, 'dev', { kind: 'stage', parent_id: goal.work_item_id })
const deep = boardItem(3, 'todo', {
  parent_id: stage.work_item_id,
  projects: [project('alpha', 'Alpha')],
})
const asked = boardItem(4, 'todo', { withheld: ['question'] })
const elsewhere = boardItem(5, 'todo', {
  other_space: { key: 'ALPHA', name: 'Alpha space' },
  projects: [project('beta', 'Beta')],
})
const loose = boardItem(6, 'todo')
const space = [goal, stage, deep, asked, elsewhere, loose]
const lineage = lineageIn(space)

const kept = (filter: WorkFilter) =>
  references(space.filter((item) => matchesWorkFilter(item, filter, lineage)))
function filterOf(...tokens: WorkFilterToken[]): WorkFilter {
  let filter: WorkFilter = { text: '' }
  for (const token of tokens) filter = addToken(filter, token)
  return filter
}

describe('the new conditions', () => {
  it('keeps a task whose question waits for the answer', () => {
    expect(kept(filterOf({ facet: 'asked' }))).toEqual(['MAIN-4'])
  })

  it('keeps another space’s cards, and with «≠» every card but those', () => {
    const only = filterOf({ facet: 'elsewhere', value: 'other' })
    expect(kept(only)).toEqual(['MAIN-5'])
    const none = negateToken(only, { facet: 'elsewhere', value: 'other' })
    expect(kept(none)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4', 'MAIN-6'])
    expect(tokenName({ facet: 'elsewhere', value: 'other', not: true }, t)).toBe(
      'Not from another space',
    )
  })
})

describe('the new facets', () => {
  it('keeps the work naming a project, or naming none', () => {
    expect(kept(filterOf({ facet: 'project', value: 'alpha' }))).toEqual(['MAIN-3'])
    expect(kept(filterOf({ facet: 'project', value: NO_PROJECT }))).toEqual([
      'MAIN-1',
      'MAIN-2',
      'MAIN-4',
      'MAIN-6',
    ])
  })

  it('keeps a goal’s or a stage’s whole subtree, the container included', () => {
    expect(kept(filterOf({ facet: 'goal', value: 'MAIN-1' }))).toEqual([
      'MAIN-1',
      'MAIN-2',
      'MAIN-3',
    ])
    expect(kept(filterOf({ facet: 'goal', value: 'MAIN-2' }))).toEqual(['MAIN-2', 'MAIN-3'])
    const outside = filterOf({ facet: 'goal', value: 'MAIN-2', not: true })
    expect(kept(outside)).toEqual(['MAIN-1', 'MAIN-4', 'MAIN-5', 'MAIN-6'])
  })
})

describe('the menu', () => {
  const groups = filterGroups({ categories: [], filter: { text: '' }, held: 0, items: space, t })
  const values = (id: string) =>
    groups.find((group) => group.id === id)?.options.map((option) => [option.text, option.detail])

  it('offers the four conditions first', () => {
    expect(values('conditions')?.map(([text]) => text)).toEqual([
      'Workable',
      'Has an assignee',
      'Waiting for my answer',
      'From another space',
    ])
  })

  it('offers each project by name and «No project», and each container with its path', () => {
    expect(values('project')).toEqual([
      ['Alpha', undefined],
      ['Beta', undefined],
      ['No project', undefined],
    ])
    expect(values('goal')).toEqual([
      ['MAIN-1 · Item 1', undefined],
      ['MAIN-2 · Item 2', 'MAIN-1 › MAIN-2'],
    ])
  })

  it('steps into «Project» and «Goal or stage» from the facets, as into any facet with values', () => {
    const facets = stepGroups(groups, 'facets', '', t).find((group) => group.id === 'facets')
    // No state, holder or label is there to offer, so those facets are not.
    expect(facets?.options.map((option) => option.text)).toEqual([
      'Kind',
      'Priority',
      'Project',
      'Goal or stage',
    ])
  })
})

describe('the address', () => {
  it('keeps every new condition and facet across a reload', () => {
    const filter = filterOf(
      { facet: 'asked' },
      { facet: 'elsewhere', value: 'other', not: true },
      { facet: 'project', value: 'alpha' },
      { facet: 'goal', value: 'MAIN-1' },
    )
    const { complete, state } = writeWorkFilter({}, filter, 4096)
    expect(complete).toBe(true)
    expect(state).toEqual({ asked: true, elsewhere: '%-other', proj: 'alpha', goal: 'MAIN-1' })
    expect(readWorkFilter(state)).toEqual(filter)
  })

  it('reads a value of «From another space» it does not know as no filter there', () => {
    expect(readWorkFilter({ elsewhere: 'former' })).toEqual({ text: '' })
  })
})
