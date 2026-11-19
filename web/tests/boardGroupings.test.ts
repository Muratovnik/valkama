/**
 * The board's lanes by stage and by project, the lanes of another space's work, and
 * what a lane is called: the groupings beside the goal's (`boardLanes.test.ts`).
 */
import { describe, expect, it } from 'vitest'

import { boardLanes, NO_PARENT } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardLane } from '@/widgets/work-item-views/utils/boardLanes.ts'
import { laneTitle } from '@/widgets/work-item-views/utils/laneTitle.ts'
import { listProjectGroups } from '@/widgets/work-item-views/utils/listGroups.ts'

import { boardGoal, boardItem, references } from './fixtures/board.ts'
import { i18n } from './support/workItemBoardHarness.ts'

const { t } = i18n().global
const project = (id: string) => ({ project_id: id, display_name: null, source: 'named' as const })
const projects = [
  { project_id: 'alpha', display_name: 'Alpha' },
  { project_id: 'beta', display_name: 'Beta' },
]

// MAIN-1 is a goal with the stage MAIN-2 under it, and MAIN-3 a stage under MAIN-2.
const goal = boardGoal(1)
const stage = boardGoal(2, 'dev', { kind: 'stage', parent_id: goal.work_item_id })
const inner = boardGoal(3, 'dev', { kind: 'stage', parent_id: stage.work_item_id })
const underGoal = boardItem(10, 'todo', {
  parent_id: goal.work_item_id,
  projects: [project('alpha')],
})
const underStage = boardItem(11, 'todo', {
  parent_id: stage.work_item_id,
  projects: [project('beta')],
})
const deepest = boardItem(12, 'dev', {
  parent_id: inner.work_item_id,
  projects: [project('alpha'), project('beta')],
})
const loose = boardItem(13, 'backlog')
const elsewhere = boardItem(14, 'todo', {
  other_space: { key: 'ALPHA', name: 'Alpha space' },
  projects: [project('alpha'), project('gamma')],
})
const work = [underGoal, underStage, deepest, loose, elsewhere]
const space = [goal, stage, inner, ...work]

function lanes(grouping: 'goal' | 'project' | 'stage', visible = space) {
  return boardLanes({ filtered: false, grouping, projects, scope: space, space, visible })
}

const title = (lane: BoardLane | undefined) => (lane ? laneTitle(lane.head, t) : '')
const drawn = (found: BoardLane[]) =>
  Object.fromEntries(found.map((lane) => [title(lane), references(lane.items)]))

describe('the board by goal', () => {
  it('names the stage a tile stands under, and none for work right under the goal', () => {
    const lane = lanes('goal').find((each) => each.id === goal.work_item_id)
    expect(lane?.stages.get(underStage.work_item_id)?.reference).toBe('MAIN-2')
    expect(lane?.stages.get(deepest.work_item_id)?.reference).toBe('MAIN-3')
    expect(lane?.stages.has(underGoal.work_item_id)).toBe(false)
  })

  it('calls the work under no goal «No goal», and gives another space’s work its own lane', () => {
    const found = lanes('goal')
    expect(found.map((lane) => title(lane))).toEqual([
      'Item 1',
      'No goal',
      'Space ALPHA · Alpha space',
    ])
    expect(
      found.find((lane) => lane.id === NO_PARENT)?.items.map((item) => item.reference),
    ).toEqual(['MAIN-13'])
  })
})

describe('the board by stage', () => {
  it('gives every container a lane named by its path, and puts work under the nearest', () => {
    expect(drawn(lanes('stage'))).toEqual({
      'Item 1': ['MAIN-10'],
      'Item 1 › Item 2': ['MAIN-11'],
      'Item 1 › Item 2 › Item 3': ['MAIN-12'],
      'No goal': ['MAIN-13'],
      'Space ALPHA · Alpha space': ['MAIN-14'],
    })
  })

  it('draws no container as a tile and names no stage on a tile', () => {
    const found = lanes('stage')
    const tiles = found.flatMap((lane) => references(lane.items))
    expect(tiles).not.toContain('MAIN-2')
    expect(found.every((lane) => lane.stages.size === 0)).toBe(true)
  })
})

describe('the board by project', () => {
  it('puts a card naming one project in its lane, several in one lane, and none in another', () => {
    expect(drawn(lanes('project'))).toEqual({
      // Another space's card counts only the projects of this space it names.
      'Alpha': ['MAIN-10', 'MAIN-14'],
      'Beta': ['MAIN-11'],
      'Several projects': ['MAIN-12'],
      // An accepted goal or stage stands in no column, so in no lane; MAIN-1..3 are in Dev.
      'No project': ['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-13'],
    })
  })

  it('keeps every project’s lane, an empty one included, in the space’s order', () => {
    const found = lanes('project', [])
    expect(found.map((lane) => title(lane))).toEqual([
      'Alpha',
      'Beta',
      'Several projects',
      'No project',
    ])
  })

  it('leaves an accepted open goal out of every lane', () => {
    const accepted = boardGoal(4, 'dev', { state: null })
    const found = boardBy([...space, accepted])
    expect(found.flatMap((lane) => references(lane.items))).not.toContain('MAIN-4')
  })
})

function boardBy(items: typeof space) {
  return boardLanes({
    filtered: false,
    grouping: 'project',
    projects,
    scope: items,
    space: items,
    visible: items,
  })
}

describe('the list by project', () => {
  it('stands each card under its group, the groups in the board’s order with their counts', () => {
    const grouped = listProjectGroups(work, projects, t)
    const groups = grouped.items.filter((item) => item.work_item_id.startsWith('group:'))
    expect(groups.map((item) => item.title)).toEqual([
      'Alpha',
      'Beta',
      'Several projects',
      'No project',
    ])
    expect(groups.map((item) => grouped.source.parentId(item))).toEqual([null, null, null, null])
    expect(grouped.source.parentId(underGoal)).toBe('group:project:alpha')
    expect(grouped.source.parentId(elsewhere)).toBe('group:project:alpha')
    expect(grouped.source.parentId(deepest)).toBe('group:projects:several')
    expect(grouped.source.parentId(loose)).toBe('group:projects:none')
    expect(grouped.counts.get('group:project:alpha')).toEqual({ open: 2, closed: 0 })
  })

  it('shows «Several» and «No project» only with work, every project of the space always', () => {
    const grouped = listProjectGroups([underGoal], projects, t)
    expect(grouped.items.map((item) => item.title)).toEqual(['Alpha', 'Beta', 'Item 10'])
  })
})
