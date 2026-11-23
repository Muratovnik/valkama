/**
 * What the views leave out of the counts above the stage. The whole-space graph
 * draws each goal as the frame round its work, so it leaves nothing out and says
 * nothing about groups; the board grouped by goal still heads its lanes with them.
 * Another space's cards that name this space's project are counted apart.
 */
import { describe, expect, it } from 'vitest'

import { usePlanningCensus } from '@/pages/planning/composables/usePlanningCensus.ts'

import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { boardItem } from './fixtures/board.ts'

const GOAL = boardItem(1, 'dev', { kind: 'goal' })
const SPACE = [
  GOAL,
  boardItem(2, 'todo', { parent_id: GOAL.work_item_id }),
  boardItem(3, 'done', { parent_id: GOAL.work_item_id }),
  boardItem(4, 'todo'),
]

const census = (
  view: 'graph' | 'kanban' | 'list',
  grouping: 'goal' | 'none' = 'none',
  filter: WorkFilter = EMPTY_WORK_FILTER,
  space: WorkItemBrief[] = SPACE,
) =>
  usePlanningCensus(() => ({
    chain: null,
    filter,
    grouping,
    space,
    view,
  }))

describe('what a view leaves out of the counts', () => {
  it('leaves nothing out of the whole-space graph, goals included', () => {
    expect(census('graph').exclusion.value).toBeNull()
  })

  it('still names the goals the grouped board draws as rows', () => {
    expect(census('kanban', 'goal').exclusion.value).toEqual({ kind: 'lane-heads', count: 1 })
  })
})

describe('the counts of a tree under a filter', () => {
  it('count what matched, not the goal the list by goal draws as its path', () => {
    // MAIN-2 alone matches; the tree draws its goal above it as a path row.
    const counts = census('list', 'goal', { text: 'Item 2' }).counts.value
    expect(counts).toMatchObject({ matchedOpen: 1, matchedClosed: 0, open: 3, total: 4 })
  })
})

/** Two cards of space ALPHA that name this space's project, one open, one closed. */
const ALPHA = { key: 'ALPHA', name: 'Alpha' }
const ELSEWHERE = [
  boardItem(5, 'todo', { other_space: ALPHA }),
  boardItem(6, 'done', { other_space: ALPHA }),
]

describe("another space's cards in the counts", () => {
  it("counts them apart from this space's work, in every view", () => {
    for (const view of ['graph', 'kanban', 'list'] as const) {
      const counts = census(view, 'none', EMPTY_WORK_FILTER, [...SPACE, ...ELSEWHERE]).counts.value
      // The space's own four, three open, as without them; the two of ALPHA apart.
      expect(counts).toMatchObject({ total: 4, open: 3, elsewhere: 2 })
    }
  })

  it('counts none apart where the read holds none', () => {
    expect(census('graph').counts.value.elsewhere).toBe(0)
  })

  it('counts apart only what a filter let through of them', () => {
    const counts = census('graph', 'none', { text: 'Item 5' }, [...SPACE, ...ELSEWHERE]).counts
      .value
    expect(counts).toMatchObject({ matchedOpen: 0, matchedClosed: 0, elsewhere: 1 })
  })

  it("counts none apart under «≠ From another space», and this space's work as before", () => {
    const notElsewhere: WorkFilter = { ...EMPTY_WORK_FILTER, not: { elsewhere: ['other'] } }
    const counts = census('graph', 'none', notElsewhere, [...SPACE, ...ELSEWHERE]).counts.value
    expect(counts).toMatchObject({ matchedOpen: 3, matchedClosed: 1, elsewhere: 0 })
  })
})
