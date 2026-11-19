/**
 * What the views leave out of the counts above the stage. The whole-space graph
 * draws each goal as the frame round its work, so it leaves nothing out and says
 * nothing about groups; the board grouped by goal still heads its lanes with them.
 */
import { describe, expect, it } from 'vitest'

import { usePlanningCensus } from '@/pages/planning/composables/usePlanningCensus.ts'

import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter } from '@/entities/work-item/utils/workFilter.ts'

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
) =>
  usePlanningCensus(() => ({
    chain: null,
    filter,
    grouping,
    space: SPACE,
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
