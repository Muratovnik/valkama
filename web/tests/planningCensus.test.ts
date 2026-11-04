/**
 * What the views leave out of the counts above the stage. The whole-space graph
 * draws each epic as the frame round its work, so it leaves nothing out and says
 * nothing about groups; the board grouped by epic still heads its lanes with them.
 */
import { describe, expect, it } from 'vitest'

import { usePlanningCensus } from '@/pages/planning/composables/usePlanningCensus.ts'

import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'

import { boardItem } from './fixtures/board.ts'

const EPIC = boardItem(1, 'dev', { kind: 'epic', container: true })
const SPACE = [
  EPIC,
  boardItem(2, 'todo', { parent_id: EPIC.work_item_id }),
  boardItem(3, 'done', { parent_id: EPIC.work_item_id }),
  boardItem(4, 'todo'),
]

const census = (view: 'graph' | 'kanban', grouping: 'epic' | 'none' = 'none') =>
  usePlanningCensus(() => ({
    chain: null,
    filter: EMPTY_WORK_FILTER,
    grouping,
    space: SPACE,
    view,
  }))

describe('what a view leaves out of the counts', () => {
  it('leaves nothing out of the whole-space graph, epics included', () => {
    expect(census('graph').exclusion.value).toBeNull()
  })

  it('still names the epics the grouped board draws as rows', () => {
    expect(census('kanban', 'epic').exclusion.value).toEqual({ kind: 'lane-heads', count: 1 })
  })
})
