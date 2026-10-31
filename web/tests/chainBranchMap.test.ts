/**
 * The branch map's layout: which lanes a chain has and in what order, where
 * each one forks, how its members line up along it, and how the whole drawing
 * scales to the width it is given.
 *
 * Each expectation comes from the map's contract rather than from the module:
 * a lane is one origin of work, every member is one unit of the same width,
 * a lane reads finished → current → ahead, and it forks from the lane it was
 * discovered from at the position of the task it was discovered from.
 */
import { describe, expect, it } from 'vitest'

import {
  drawBranches,
  taskAt,
  taskIndexAt,
} from '@/widgets/work-item-inspector/utils/chainBranchDrawing.ts'
import { laneRuns, layoutBranches } from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'

import {
  branchedChain,
  chainOf,
  found,
  mapId,
  mapMember,
  smallBranchedChain,
} from './fixtures/chainMap.ts'

const ROOT = { id: mapId(1), reference: 'MAP-1', title: 'Root' }

const asChain = (value: unknown) => value as WorkItemChain

const refs = (members: readonly { reference: string }[]) =>
  members.map((member) => member.reference)

describe('the lanes of a chain', () => {
  it('is one lane per origin, the root’s own children first and each branch under its source', () => {
    const own = [
      mapMember('MAP-10', 'done', 'MAP-1', { closed: 10 }),
      mapMember('MAP-11', 'done', 'MAP-1', { closed: 20 }),
      mapMember('MAP-12', 'done', 'MAP-1', { closed: 30 }),
    ]
    const early = mapMember('MAP-20', 'backlog', null)
    const late = mapMember('MAP-30', 'backlog', 'MAP-99')
    const nested = mapMember('MAP-40', 'backlog', 'MAP-98')
    const chain = chainOf(ROOT, [...own, early, late, nested], {
      // `early` forks at the first child, `late` at the third, and `nested`
      // from `early`'s lane.
      edges: [found(early, own[0]), found(late, own[2]), found(nested, early)],
    })
    const { lanes } = layoutBranches(asChain(chain))
    // A later fork stands nearer its parent, so the stem of an earlier one
    // passes rows that have not started yet rather than crossing a drawn lane.
    expect(lanes.map((lane) => lane.reference)).toEqual(['MAP-1', 'MAP-99', null, 'MAP-98'])
    expect(lanes.map((lane) => lane.own)).toEqual([true, false, false, false])
    expect(lanes[0].fork).toBeNull()
    expect(lanes[1].fork).toEqual({ lane: lanes[0].key, index: 2 })
    expect(lanes[2].fork).toEqual({ lane: lanes[0].key, index: 0 })
    expect(lanes[3].fork).toEqual({ lane: lanes[2].key, index: 0 })
  })

  it('starts a branch one unit after the task it forks from, so its length is its volume', () => {
    const own = Array.from({ length: 5 }, (_, index) =>
      mapMember(`MAP-${10 + index}`, 'done', 'MAP-1', { closed: index }),
    )
    const branch = Array.from({ length: 4 }, (_, index) =>
      mapMember(`MAP-${20 + index}`, 'backlog', null, { created: 100 + index }),
    )
    const chain = chainOf(ROOT, [...own, ...branch], { edges: [found(branch[0], own[2])] })
    const { lanes, extent } = layoutBranches(asChain(chain))
    expect(lanes.map((lane) => [lane.start, lane.members.length])).toEqual([
      [0, 5],
      [3, 4],
    ])
    // The drawing is as long as the lane that reaches furthest.
    expect(extent).toBe(7)
  })

  it('forks a lane where its own epic was discovered, when the epic is a member', () => {
    const own = Array.from({ length: 6 }, (_, index) =>
      mapMember(`MAP-${10 + index}`, 'done', 'MAP-1', { closed: index }),
    )
    // The epic lives in the root's lane and was discovered from its fifth child;
    // one of its children was discovered earlier, from the first.
    const epic = mapMember('MAP-50', 'active', 'MAP-1', { created: 1, closed: undefined })
    const children = [
      mapMember('MAP-51', 'backlog', 'MAP-50', { created: 0 }),
      mapMember('MAP-52', 'backlog', 'MAP-50', { created: 5 }),
    ]
    const chain = chainOf(ROOT, [...own, epic, ...children], {
      edges: [found(epic, own[4]), found(children[0], own[0])],
    })
    const { lanes } = layoutBranches(asChain(chain))
    const branch = lanes.find((lane) => lane.reference === 'MAP-50')
    expect(branch?.fork).toEqual({ lane: lanes[0].key, index: 4 })
    expect(branch?.start).toBe(5)
  })

  it('forks from the earliest discovered member when the lane’s epic is not a member', () => {
    const own = Array.from({ length: 6 }, (_, index) =>
      mapMember(`MAP-${10 + index}`, 'done', 'MAP-1', { closed: index }),
    )
    const lane = [
      mapMember('MAP-60', 'backlog', 'MAP-77', { created: 40 }),
      mapMember('MAP-61', 'backlog', 'MAP-77', { created: 20 }),
      mapMember('MAP-62', 'backlog', 'MAP-77', { created: 30 }),
    ]
    const chain = chainOf(ROOT, [...own, ...lane], {
      edges: [found(lane[0], own[1]), found(lane[1], own[3]), found(lane[2], own[5])],
    })
    const branch = layoutBranches(asChain(chain)).lanes[1]
    // MAP-61 was created first, so the lane forks where it was found: the 4th child.
    expect(branch.fork?.index).toBe(3)
  })

  it('forks a lane discovered from the root itself at the start of the root’s lane', () => {
    const own = [mapMember('MAP-10', 'done', 'MAP-1'), mapMember('MAP-11', 'done', 'MAP-1')]
    const direct = mapMember('MAP-20', 'backlog', null)
    const chain = chainOf(ROOT, [...own, direct], {
      edges: [{ from: direct.work_item_id, to: ROOT.id, kind: 'discovered-from' }],
    })
    const [trunk, branch] = layoutBranches(asChain(chain)).lanes
    expect(branch.fork).toEqual({ lane: trunk.key, index: -1 })
    expect(branch.start).toBe(0)
  })

  it('gives even a lane of one member a lane of its own', () => {
    const own = [mapMember('MAP-10', 'done', 'MAP-1')]
    const single = mapMember('MAP-20', 'queued', 'MAP-88')
    const chain = chainOf(ROOT, [...own, single], { edges: [found(single, own[0])] })
    const { lanes } = layoutBranches(asChain(chain))
    expect(lanes.map((lane) => [lane.reference, lane.members.length])).toEqual([
      ['MAP-1', 1],
      ['MAP-88', 1],
    ])
  })

  it('still draws a tree when two lanes were each discovered from the other', () => {
    const own = [mapMember('MAP-10', 'done', 'MAP-1')]
    const left = mapMember('MAP-20', 'backlog', 'MAP-70', { created: 1 })
    const right = mapMember('MAP-30', 'backlog', 'MAP-80', { created: 2 })
    const other = mapMember('MAP-31', 'backlog', 'MAP-80', { created: 3 })
    const chain = chainOf(ROOT, [...own, left, right, other], {
      edges: [found(left, right), found(right, left), found(other, own[0])],
    })
    const { lanes } = layoutBranches(asChain(chain))
    expect(lanes).toHaveLength(3)
    // Every fork names a lane drawn above it.
    for (const [row, lane] of lanes.entries()) {
      if (!lane.fork) continue
      const parent = lanes.findIndex((candidate) => candidate.key === lane.fork?.lane)
      expect(parent).toBeGreaterThanOrEqual(0)
      expect(parent).toBeLessThan(row)
    }
  })

  it('reads the epic scope as a single lane', () => {
    const members = [
      mapMember('MAP-10', 'done', 'MAP-1'),
      mapMember('MAP-11', 'active', 'MAP-1', { holder: 'codex' }),
      mapMember('MAP-12', 'backlog', 'MAP-1'),
    ]
    const { lanes, extent } = layoutBranches(asChain(chainOf(ROOT, members, { scope: 'epic' })))
    expect(lanes).toHaveLength(1)
    expect(lanes[0].own).toBe(true)
    expect(extent).toBe(3)
  })

  it('has nothing to draw for an empty chain', () => {
    const layout = layoutBranches(asChain(chainOf(ROOT, [])))
    expect(layout.lanes).toEqual([])
    expect(layout.extent).toBe(0)
    const drawing = drawBranches(layout, 360)
    expect(drawing.lanes).toEqual([])
    expect(drawing.height).toBe(0)
  })
})

describe('the order inside a lane', () => {
  it('runs finished by closing time, then review and in progress, then blocked, queued and backlog', () => {
    const members = [
      mapMember('MAP-10', 'backlog', 'MAP-1', { created: 1 }),
      mapMember('MAP-11', 'queued', 'MAP-1', { created: 2 }),
      mapMember('MAP-12', 'done', 'MAP-1', { created: 1, closed: 90 }),
      mapMember('MAP-13', 'active', 'MAP-1', { created: 3 }),
      mapMember('MAP-14', 'blocked', 'MAP-1', { created: 4 }),
      mapMember('MAP-15', 'review', 'MAP-1', { created: 5 }),
      mapMember('MAP-16', 'done', 'MAP-1', { created: 9, closed: 50 }),
    ]
    const [lane] = layoutBranches(asChain(chainOf(ROOT, members))).lanes
    expect(refs(lane.members)).toEqual([
      'MAP-16',
      'MAP-12',
      'MAP-15',
      'MAP-13',
      'MAP-14',
      'MAP-11',
      'MAP-10',
    ])
    expect(lane.groups).toEqual([
      'done',
      'done',
      'review',
      'active',
      'blocked',
      'queued',
      'backlog',
    ])
    expect(lane.counts).toEqual({ done: 2, current: 2, ahead: 3 })
  })

  it('puts ready work first inside a category, then the oldest', () => {
    const members = [
      mapMember('MAP-10', 'backlog', 'MAP-1', { created: 1 }),
      mapMember('MAP-11', 'backlog', 'MAP-1', { created: 3, ready: true }),
      mapMember('MAP-12', 'backlog', 'MAP-1', { created: 2, ready: true }),
      mapMember('MAP-13', 'backlog', 'MAP-1', { created: 0 }),
    ]
    const [lane] = layoutBranches(asChain(chainOf(ROOT, members))).lanes
    expect(refs(lane.members)).toEqual(['MAP-12', 'MAP-11', 'MAP-13', 'MAP-10'])
  })

  it('counts cancelled work as finished, as the card groups it', () => {
    const cancelled = mapMember('MAP-10', 'done', 'MAP-1')
    Object.assign(cancelled.state, { key: 'cancelled', name: 'Cancelled', category: 'cancelled' })
    const [lane] = layoutBranches(
      asChain(chainOf(ROOT, [cancelled, mapMember('MAP-11', 'backlog', 'MAP-1')])),
    ).lanes
    expect(lane.groups).toEqual(['done', 'backlog'])
  })
})

describe('the drawing at a width', () => {
  const live = asChain(branchedChain(ROOT, 'MAP'))

  it('takes a comfortable unit when there is room and shrinks to fit when there is not', () => {
    const small = layoutBranches(asChain(chainOf(ROOT, [mapMember('MAP-10', 'done', 'MAP-1')])))
    expect(drawBranches(small, 600).unit).toBe(26)
    const layout = layoutBranches(live)
    const drawing = drawBranches(layout, 342)
    expect(drawing.unit).toBeCloseTo(342 / layout.extent, 6)
    // Nothing reaches past the width it was given.
    for (const lane of drawing.lanes) expect(lane.x1).toBeLessThanOrEqual(342 + 1e-9)
  })

  it('lays the live-shaped chain out as six lanes in fork order, with their volumes', () => {
    const { lanes, total } = layoutBranches(live)
    expect(total).toBe(617)
    expect(lanes.map((lane) => [lane.reference, lane.members.length])).toEqual([
      ['MAP-1', 273],
      ['MAP-7001', 1],
      ['MAP-4000', 243],
      ['MAP-7002', 1],
      ['MAP-4001', 11],
      [null, 88],
    ])
    expect(lanes.reduce((sum, lane) => sum + lane.counts.current + lane.counts.ahead, 0)).toBe(132)
    // The discovered epic forks where it was found: the root's 121st closed child.
    expect(lanes[2].fork).toEqual({ lane: lanes[0].key, index: 120 })
    expect(lanes[2].start).toBe(121)
  })

  it('merges a narrow lane into one run per state and splits a wide one into one segment per task', () => {
    const live = layoutBranches(asChain(branchedChain(ROOT, 'MAP')))
    const dense = drawBranches(live, 342)
    expect(dense.dense).toBe(true)
    const trunk = live.lanes[0]
    expect(laneRuns(trunk, true)).toEqual([
      { group: 'done', from: 0, to: 263 },
      { group: 'review', from: 263, to: 264 },
      { group: 'active', from: 264, to: 266 },
      { group: 'backlog', from: 266, to: 273 },
    ])
    const small = layoutBranches(asChain(smallBranchedChain(ROOT, 'MAP')))
    const wide = drawBranches(small, 620)
    expect(wide.dense).toBe(false)
    expect(laneRuns(small.lanes[0], false)).toHaveLength(small.lanes[0].members.length)
  })

  it('raises work under way in a dense lane as marks that keep apart and name their own tasks', () => {
    const drawing = drawBranches(layoutBranches(live), 342)
    const epic = drawing.lanes[2]
    expect(epic.lane.reference).toBe('MAP-4000')
    // One review, eight in development and one blocked: under a pixel each.
    expect(epic.pills.map((pill) => pill.group)).toEqual(['review', 'active', 'blocked'])
    for (const [index, pill] of epic.pills.entries()) {
      expect(pill.right - pill.left).toBeGreaterThanOrEqual(7)
      if (index) expect(pill.left).toBeGreaterThan(epic.pills[index - 1].right)
      const middle = (pill.left + pill.right) / 2
      expect(epic.lane.groups[taskAt(epic, middle, drawing.unit)]).toBe(pill.group)
    }
    // A lane wide enough to show every member needs none.
    const small = layoutBranches(asChain(smallBranchedChain(ROOT, 'MAP')))
    expect(drawBranches(small, 620).lanes.flatMap((lane) => lane.pills)).toEqual([])
  })

  it('shows junction dots and reference labels only where a unit has room for them', () => {
    const small = layoutBranches(asChain(smallBranchedChain(ROOT, 'MAP')))
    const wide = drawBranches(small, 620)
    expect(wide.dots).toBe(true)
    // Labels name current work, never overlap, and stay inside the drawing.
    const labels = wide.lanes.flatMap((lane) => lane.labels)
    expect(labels.length).toBeGreaterThan(0)
    for (const lane of wide.lanes) {
      const boxes = lane.labels.map(({ box }) => [box.left, box.left + (box.width ?? 0)])
      for (const [index, [left, right]] of boxes.entries()) {
        expect(left).toBeGreaterThanOrEqual(0)
        expect(right).toBeLessThanOrEqual(620)
        if (index) expect(left).toBeGreaterThan(boxes[index - 1][1])
      }
      for (const label of lane.labels)
        expect(['review', 'active', 'blocked']).toContain(lane.lane.groups[label.index])
    }
    const dense = drawBranches(layoutBranches(live), 342)
    expect(dense.dots).toBe(false)
    expect(dense.lanes.flatMap((lane) => lane.labels)).toEqual([])
  })

  it('draws a lane of one task in a dense map as a short lane with an end, not a pixel', () => {
    const drawing = drawBranches(layoutBranches(live), 342)
    expect(drawing.dense).toBe(true)
    for (const reference of ['MAP-7001', 'MAP-7002']) {
      const lane = drawing.lanes.find((drawn) => drawn.lane.reference === reference)
      expect(lane?.lane.members).toHaveLength(1)
      if (!lane) continue
      // Long enough to read as a lane, and still the shortest by far: the
      // root's own lane of 273 is over a hundred times its unit.
      expect(lane.x1 - lane.x0).toBeGreaterThanOrEqual(16)
      expect(lane.x1 - lane.x0).toBeLessThan(drawing.lanes[0].x1 / 10)
      expect(lane.x1).toBeLessThanOrEqual(342)
      // A dot closes it, and its one task is under the pointer anywhere along it.
      expect(lane.dots.map((path) => path.group)).toEqual([lane.lane.groups[0]])
      expect(taskAt(lane, lane.x1 - 1, drawing.unit)).toBe(0)
      expect(lane.band.left ?? 0).toBeLessThanOrEqual(lane.x0)
      expect((lane.band.left ?? 0) + (lane.band.width ?? 0)).toBeGreaterThanOrEqual(lane.x1)
    }
    // A lane long enough on its own is drawn at its true length, with no end dot.
    expect(drawing.lanes[0].x1).toBeCloseTo(273 * drawing.unit, 6)
    expect(drawing.lanes[0].dots).toEqual([])
  })

  it('narrows the unit so a short lane forked at the far end still ends inside the width', () => {
    const own = Array.from({ length: 300 }, (_, index) =>
      mapMember(`MAP-${1000 + index}`, 'done', 'MAP-1', { closed: index }),
    )
    const last = mapMember('MAP-2000', 'backlog', 'MAP-90', { created: 400 })
    const layout = layoutBranches(
      asChain(chainOf(ROOT, [...own, last], { edges: [found(last, own[299])] })),
    )
    // At 342 ÷ 301 a unit, the branch would start at 340.9 and its least
    // length would run 15px past the edge.
    const drawing = drawBranches(layout, 342)
    const branch = drawing.lanes[1]
    expect(branch.x1 - branch.x0).toBeGreaterThanOrEqual(16)
    expect(branch.x1).toBeLessThanOrEqual(342 + 1e-9)
    expect(drawing.unit).toBeLessThan(342 / 301)
  })

  it('stacks the lanes top to bottom and draws each fork from its parent’s line to its own', () => {
    const layout = layoutBranches(asChain(smallBranchedChain(ROOT, 'MAP')))
    const drawing = drawBranches(layout, 620)
    const [trunk, branch] = drawing.lanes
    expect(trunk.stem).toBeNull()
    expect(branch.y).toBeGreaterThan(trunk.y)
    expect(drawing.height).toBeGreaterThan(branch.y)
    const fork = layout.lanes[1].fork
    expect(fork).not.toBeNull()
    // The stem leaves the parent's line in the middle of the source task.
    const sourceX = (layout.lanes[0].start + (fork?.index ?? 0) + 0.5) * drawing.unit
    expect(branch.stem?.startsWith(`M${sourceX.toFixed(2)},${trunk.y.toFixed(2)}`)).toBe(true)
  })
})

describe('the task under the pointer', () => {
  it('is the unit the x position falls in, clamped to the lane', () => {
    const own = Array.from({ length: 4 }, (_, index) =>
      mapMember(`MAP-${10 + index}`, 'done', 'MAP-1', { closed: index }),
    )
    const branch = Array.from({ length: 3 }, (_, index) =>
      mapMember(`MAP-${20 + index}`, 'backlog', null, { created: 100 + index }),
    )
    const layout = layoutBranches(
      asChain(chainOf(ROOT, [...own, ...branch], { edges: [found(branch[0], own[1])] })),
    )
    const lane = layout.lanes[1]
    // The branch starts at unit 2; with 10px units its tasks span 20–50px.
    expect(taskIndexAt(lane, 20, 10)).toBe(0)
    expect(taskIndexAt(lane, 29.9, 10)).toBe(0)
    expect(taskIndexAt(lane, 30, 10)).toBe(1)
    expect(taskIndexAt(lane, 49, 10)).toBe(2)
    expect(taskIndexAt(lane, 5, 10)).toBe(0)
    expect(taskIndexAt(lane, 400, 10)).toBe(2)
  })
})
