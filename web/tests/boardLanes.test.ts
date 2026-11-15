/**
 * The board read by goal: which lanes there are, what each holds and counts,
 * and the order a reader meets them in.
 */
import { describe, expect, it } from 'vitest'

import { boardLanes, NO_PARENT, outOfSight } from '@/widgets/work-item-views/utils/boardLanes.ts'

import { boardGoal, boardId, boardItem, references } from './fixtures/board.ts'

const goalOpen = boardGoal(1)
const goalDone = boardGoal(2, 'done')
const goalEmpty = boardItem(3, 'backlog', { kind: 'goal' })
const space = [
  goalEmpty,
  boardItem(10, 'backlog', { parent_id: goalDone.work_item_id }),
  boardItem(11, 'backlog'),
  boardItem(12, 'todo', { parent_id: goalOpen.work_item_id }),
  goalOpen,
  boardItem(13, 'dev', { parent_id: goalOpen.work_item_id }),
  goalDone,
  boardItem(14, 'done', { parent_id: goalOpen.work_item_id }),
  boardItem(15, 'done', { parent_id: goalDone.work_item_id }),
]
// Goal 2 is closed, but MAIN-10 under it is still open; make one lane truly done.
const allDone = space.map((item) =>
  item.reference === 'MAIN-10' ? boardItem(10, 'done', { parent_id: goalDone.work_item_id }) : item,
)

function lanes(items = allDone, visible = items, filtered = false) {
  return boardLanes({ filtered, scope: items, space: items, visible })
}

describe('the board grouped by goal', () => {
  it('gives every goal a lane, its children in it, and the goal itself none as a tile', () => {
    const found = lanes()
    const open = found.find((lane) => lane.id === goalOpen.work_item_id)
    expect(open?.goal?.reference).toBe('MAIN-1')
    expect(references(open?.items ?? [])).toEqual(['MAIN-12', 'MAIN-13', 'MAIN-14'])
    expect(found.flatMap((lane) => references(lane.items))).not.toContain('MAIN-1')
    expect(found.flatMap((lane) => references(lane.items))).not.toContain('MAIN-2')
  })

  it('counts each lane’s open and closed work', () => {
    const counted = Object.fromEntries(
      lanes().map((lane) => [lane.id, [lane.open, lane.closed]] as const),
    )
    expect(counted).toEqual({
      [goalOpen.work_item_id]: [2, 1],
      [goalEmpty.work_item_id]: [0, 0],
      [goalDone.work_item_id]: [0, 2],
      [NO_PARENT]: [1, 0],
    })
  })

  it('reads the lanes with open work first, then the rest, and no goal last', () => {
    // MAIN-3 is listed before MAIN-2 in the space, and both hold nothing open.
    expect(lanes().map((lane) => lane.goal?.reference ?? NO_PARENT)).toEqual([
      'MAIN-1',
      'MAIN-3',
      'MAIN-2',
      NO_PARENT,
    ])
    // With open work under it, the goal that closed comes up among the open ones,
    // in the order the space lists its goals.
    expect(lanes(space).map((lane) => lane.goal?.reference ?? NO_PARENT)).toEqual([
      'MAIN-1',
      'MAIN-2',
      'MAIN-3',
      NO_PARENT,
    ])
  })

  it('keeps an empty goal’s lane unfiltered and leaves out every lane a filter emptied', () => {
    expect(lanes().some((lane) => lane.id === goalEmpty.work_item_id)).toBe(true)
    const matched = lanes(
      allDone,
      [boardItem(13, 'dev', { parent_id: goalOpen.work_item_id })],
      true,
    )
    expect(matched.map((lane) => lane.id)).toEqual([goalOpen.work_item_id])
    // The counts still describe the goal, not the filter.
    expect([matched[0].open, matched[0].closed]).toEqual([2, 1])
  })

  it('names a goal from the space when a chain holds its child but not the goal', () => {
    const child = boardItem(13, 'dev', { parent_id: goalOpen.work_item_id })
    const found = boardLanes({ filtered: false, scope: [child], space, visible: [child] })
    expect(found.map((lane) => lane.goal?.title)).toEqual(['Item 1'])
  })

  it('files an item whose parent the space does not hold under no goal', () => {
    const orphan = boardItem(40, 'todo', { parent_id: boardId(999) })
    const found = boardLanes({
      filtered: false,
      scope: [orphan],
      space: [orphan],
      visible: [orphan],
    })
    expect(found.map((lane) => lane.id)).toEqual([NO_PARENT])
  })
})

const laneStates = ['backlog', 'todo', 'dev', 'review', 'done'].map((key) => ({
  key,
  is_terminal: key === 'done',
}))
const holding = (held: Record<string, number>) => (state: { key: string }) => held[state.key] ?? 0
const named = (side: { count: number; state: { key: string } }[]) =>
  side.map((entry) => `${entry.count} ${entry.state.key}`)

describe('what a lane holds out of sight', () => {
  it('names the open work on each side of the columns in view', () => {
    const { left, right } = outOfSight(laneStates, 1, 2, holding({ backlog: 2, dev: 1, review: 3 }))
    expect(named(left)).toEqual(['2 backlog'])
    expect(named(right)).toEqual(['3 review'])
  })

  it('names finished work only when nothing of the lane is in view', () => {
    expect(named(outOfSight(laneStates, 0, 2, holding({ dev: 1, done: 5 })).right)).toEqual([])
    expect(named(outOfSight(laneStates, 0, 2, holding({ review: 2, done: 5 })).right)).toEqual([
      '2 review',
      '5 done',
    ])
  })

  it('names nothing when every column with work is in view', () => {
    expect(outOfSight(laneStates, 0, 4, holding({ backlog: 1, done: 3 }))).toEqual({
      left: [],
      right: [],
    })
  })
})
