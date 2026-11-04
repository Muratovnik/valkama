/**
 * The two whole spaces the graph of frames is tested on hold the shape they
 * promise: the counts below are written out, not read back from the builder, so
 * a builder that drifted fails here rather than quietly weakening every test
 * that stands on it.
 */
import { describe, expect, it } from 'vitest'

import { validateReadModel } from '@/shared/api/planningModel.ts'
import type { PlanningReadModel, WorkItemBrief } from '@/shared/api/planningModel.ts'

import { placedSample } from './fixtures/graphSample.ts'
import { broadSpace, deepSpace, liveWorkFor } from './fixtures/graphSpaces.ts'

const open = (item: WorkItemBrief) => !item.state.is_terminal

function shape(model: PlanningReadModel) {
  const items = model.work_items
  const byId = new Map(items.map((item) => [item.work_item_id, item]))
  const groups = items.filter((item) => item.container)
  const work = items.filter((item) => !item.container)
  const openWorkUnder = (group: WorkItemBrief) =>
    work.some((item) => item.parent_id === group.work_item_id && open(item))
  const children = groups.map((group) =>
    items.filter((item) => item.parent_id === group.work_item_id),
  )
  const largest = children.toSorted((left, right) => right.length - left.length)[0] ?? []
  const kinds = (kind: string) => model.links.filter((link) => link.kind === kind).length
  const openWork = work.filter((item) => open(item))
  return {
    items: [items.length, items.filter((item) => open(item)).length],
    openWork: openWork.length,
    epics: [
      groups.length,
      groups.filter((group) => open(group)).length,
      groups.filter((group) => open(group) && openWorkUnder(group)).length,
    ],
    closedEpicsWithOpenWork: groups.filter((group) => !open(group) && openWorkUnder(group)).length,
    nested: groups.filter(
      (group) => group.parent_id !== null && byId.get(group.parent_id)?.container,
    ).length,
    looseOpen: openWork.filter((item) => item.parent_id === null).length,
    largest: [largest.length, largest.filter((item) => open(item)).length],
    links: [kinds('discovered-from'), kinds('blocks'), kinds('relates-to'), kinds('duplicates')],
    claims: [
      openWork.filter((item) => item.claim_state === 'live').length,
      openWork.filter((item) => item.claim_state === 'unconfirmed').length,
      openWork.filter((item) => item.claim_state === null).length,
    ],
  }
}

describe('the spaces the graph of frames is tested on', () => {
  it('the broad space passes the read model contract and has the broad shape', () => {
    const { model } = broadSpace()
    expect(() => validateReadModel(model)).not.toThrow()
    expect(shape(model)).toEqual({
      items: [1397, 352],
      openWork: 311,
      epics: [165, 41, 38],
      closedEpicsWithOpenWork: 4,
      // The one nested epic is the fixture's own addition.
      nested: 1,
      looseOpen: 158,
      largest: [54, 21],
      links: [360, 177, 106, 0],
      claims: [16, 78, 217],
    })
  })

  it('the deep space passes the read model contract and has the deep shape', () => {
    const { model } = deepSpace()
    expect(() => validateReadModel(model)).not.toThrow()
    expect(shape(model)).toEqual({
      items: [1120, 175],
      openWork: 167,
      epics: [25, 8, 8],
      closedEpicsWithOpenWork: 0,
      nested: 0,
      looseOpen: 46,
      largest: [273, 100],
      links: [658, 148, 358, 11],
      claims: [7, 0, 160],
    })
  })

  it('the broad space links work to epics the way the frames must draw', () => {
    const { model, lone } = broadSpace()
    const byId = new Map(model.work_items.map((item) => [item.work_item_id, item]))
    const isEpic = (id: string) => byId.get(id)?.container === true
    const touching = model.links.filter((link) => isEpic(link.from) || isEpic(link.to))
    const openWorkEnd = (id: string) => {
      const item = byId.get(id)
      return item !== undefined && !item.container && !item.state.is_terminal
    }
    const toOpen = touching.filter((link) => openWorkEnd(link.from) || openWorkEnd(link.to))
    const own = toOpen.filter(
      (link) =>
        byId.get(link.from)?.parent_id === link.to || byId.get(link.to)?.parent_id === link.from,
    )
    expect([touching.length, toOpen.length, own.length]).toEqual([87, 33, 5])
    expect(model.links.filter((link) => !byId.has(link.from) || !byId.has(link.to))).toHaveLength(2)
    // The item whose only link is to its own epic, in an epic small enough to stay open.
    expect(lone).not.toBeNull()
    const mine = model.links.filter(
      (link) => link.from === lone?.item.work_item_id || link.to === lone?.item.work_item_id,
    )
    expect(mine.map((link) => [link.from, link.to])).toEqual([
      [lone?.item.work_item_id, lone?.epic.work_item_id],
    ])
  })

  it('the same space arrives on every build', () => {
    expect(broadSpace().model).toEqual(broadSpace().model)
  })

  it('live work names every live claim, in all three states', () => {
    const { model } = broadSpace()
    const live = liveWorkFor(model)
    expect(Object.keys(live)).toHaveLength(16)
    expect(new Set(Object.values(live).map((entry) => entry.state))).toEqual(
      new Set(['working', 'waiting', 'quiet']),
    )
  })

  it('the laid-out sample keeps every card inside its frame and counts each frame whole', () => {
    const sample = placedSample()
    const frames = new Map(sample.frames.map((frame) => [frame.id, frame]))
    for (const node of sample.nodes) {
      const frame = frames.get(node.frameId)
      expect(frame?.folded).toBe(false)
      if (!frame) continue
      expect(node.x).toBeGreaterThanOrEqual(frame.x)
      expect(node.y).toBeGreaterThanOrEqual(frame.y)
      expect(node.x + node.width).toBeLessThanOrEqual(frame.x + frame.width)
      expect(node.y + node.height).toBeLessThanOrEqual(frame.y + frame.height)
    }
    for (const frame of sample.frames) {
      const { active, ahead, blocked, done, review, total } = frame.progress
      expect(active + ahead + blocked + done + review).toBe(total)
      expect(frame.members).toHaveLength(total)
    }
  })
})
