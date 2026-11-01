/**
 * The board read by epic: which lanes there are, what each holds and counts,
 * and the order a reader meets them in.
 */
import { describe, expect, it } from 'vitest'

import { boardLanes, NO_EPIC, outOfSight } from '@/widgets/work-item-views/utils/boardLanes.ts'

import { boardEpic, boardId, boardItem, references } from './fixtures/board.ts'

const epicOpen = boardEpic(1)
const epicDone = boardEpic(2, 'done')
const epicEmpty = boardItem(3, 'backlog', { kind: 'epic' })
const space = [
  epicEmpty,
  boardItem(10, 'backlog', { parent_id: epicDone.work_item_id }),
  boardItem(11, 'backlog'),
  boardItem(12, 'todo', { parent_id: epicOpen.work_item_id }),
  epicOpen,
  boardItem(13, 'dev', { parent_id: epicOpen.work_item_id }),
  epicDone,
  boardItem(14, 'done', { parent_id: epicOpen.work_item_id }),
  boardItem(15, 'done', { parent_id: epicDone.work_item_id }),
]
// Epic 2 is closed, but MAIN-10 under it is still open; make one lane truly done.
const allDone = space.map((item) =>
  item.reference === 'MAIN-10' ? boardItem(10, 'done', { parent_id: epicDone.work_item_id }) : item,
)

function lanes(items = allDone, visible = items, filtered = false) {
  return boardLanes({ filtered, scope: items, space: items, visible })
}

describe('the board grouped by epic', () => {
  it('gives every epic a lane, its children in it, and the epic itself none as a tile', () => {
    const found = lanes()
    const open = found.find((lane) => lane.id === epicOpen.work_item_id)
    expect(open?.epic?.reference).toBe('MAIN-1')
    expect(references(open?.items ?? [])).toEqual(['MAIN-12', 'MAIN-13', 'MAIN-14'])
    expect(found.flatMap((lane) => references(lane.items))).not.toContain('MAIN-1')
    expect(found.flatMap((lane) => references(lane.items))).not.toContain('MAIN-2')
  })

  it('counts each lane’s open and closed work', () => {
    const counted = Object.fromEntries(
      lanes().map((lane) => [lane.id, [lane.open, lane.closed]] as const),
    )
    expect(counted).toEqual({
      [epicOpen.work_item_id]: [2, 1],
      [epicEmpty.work_item_id]: [0, 0],
      [epicDone.work_item_id]: [0, 2],
      [NO_EPIC]: [1, 0],
    })
  })

  it('reads the lanes with open work first, then the rest, and no epic last', () => {
    // MAIN-3 is listed before MAIN-2 in the space, and both hold nothing open.
    expect(lanes().map((lane) => lane.epic?.reference ?? NO_EPIC)).toEqual([
      'MAIN-1',
      'MAIN-3',
      'MAIN-2',
      NO_EPIC,
    ])
    // With open work under it, the epic that closed comes up among the open ones,
    // in the order the space lists its epics.
    expect(lanes(space).map((lane) => lane.epic?.reference ?? NO_EPIC)).toEqual([
      'MAIN-1',
      'MAIN-2',
      'MAIN-3',
      NO_EPIC,
    ])
  })

  it('keeps an empty epic’s lane unfiltered and leaves out every lane a filter emptied', () => {
    expect(lanes().some((lane) => lane.id === epicEmpty.work_item_id)).toBe(true)
    const matched = lanes(
      allDone,
      [boardItem(13, 'dev', { parent_id: epicOpen.work_item_id })],
      true,
    )
    expect(matched.map((lane) => lane.id)).toEqual([epicOpen.work_item_id])
    // The counts still describe the epic, not the filter.
    expect([matched[0].open, matched[0].closed]).toEqual([2, 1])
  })

  it('names an epic from the space when a chain holds its child but not the epic', () => {
    const child = boardItem(13, 'dev', { parent_id: epicOpen.work_item_id })
    const found = boardLanes({ filtered: false, scope: [child], space, visible: [child] })
    expect(found.map((lane) => lane.epic?.title)).toEqual(['Item 1'])
  })

  it('files an item whose parent the space does not hold under no epic', () => {
    const orphan = boardItem(40, 'todo', { parent_id: boardId(999) })
    const found = boardLanes({
      filtered: false,
      scope: [orphan],
      space: [orphan],
      visible: [orphan],
    })
    expect(found.map((lane) => lane.id)).toEqual([NO_EPIC])
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
