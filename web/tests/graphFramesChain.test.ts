/**
 * The frames a chain of a goal is drawn in: its root the outer frame and open whatever it
 * holds, its stages inside it, and the work found on the way in a band of its own.
 */
import { describe, expect, it } from 'vitest'

import { frameProjection } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import type { FrameProjectionInput } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import { FOUND_FRAME, NO_PARENT_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { FOLD_ABOVE } from '@/shared/lib/treeRows.ts'

import { item, lines, link } from './fixtures/graphFrameItems.ts'

/**
 * One chain of a goal, as the chain endpoint names it: its root, a stage under it, work in
 * each, closed work, and two items found on the way — one filed under a goal the chain does
 * not hold, one under none. Only the chain's own items are handed in.
 */
function chainItems(): WorkItemBrief[] {
  return [
    item('root', 60, { goal: true }),
    item('stage', 61, { goal: true, parent: 'root' }),
    item('t1', 62, { parent: 'root' }),
    item('t2', 63, { parent: 'stage' }),
    item('t3', 64, { parent: 'stage', state: 'dev' }),
    item('closed', 65, { parent: 'root', state: 'done' }),
    item('found-elsewhere', 66, { parent: 'outside-goal' }),
    item('found-loose', 67),
  ]
}

const chainLinks: PlanningEdge[] = [
  link('found-elsewhere', 't1'),
  link('found-loose', 't2'),
  // A blocker outside the chain: the chain names it, and its items do not hold it.
  link('outside', 't2', 'blocks'),
]

function projectChain(options: Partial<FrameProjectionInput> = {}) {
  return frameProjection({
    items: chainItems(),
    links: chainLinks,
    showDone: false,
    chainRootId: 'root',
    ...options,
  })
}

/** One more item than a frame holds before it starts folded, numbered from `from`. */
const past = (prefix: string, from: number, parent?: string) =>
  Array.from({ length: FOLD_ABOVE + 1 }, (_, index) =>
    item(`${prefix}${index}`, from + index, parent ? { parent } : {}),
  )

const frameOf = (projected: ReturnType<typeof projectChain>, id: string) =>
  projected.frames.find((frame) => frame.id === id)
const cardIds = (frame: { cards: WorkItemBrief[] } | undefined) =>
  frame?.cards.map((entry) => entry.work_item_id)

describe('a chain whose root holds work', () => {
  it('draws the root as the outer frame, a stage inside it, and each task in its parent’s', () => {
    const projected = projectChain()
    expect(projected.frames.map((frame) => [frame.id, frame.parentId])).toEqual([
      ['root', null],
      ['stage', 'root'],
      [FOUND_FRAME, null],
    ])
    expect(cardIds(frameOf(projected, 'root'))).toEqual(['t1'])
    expect(cardIds(frameOf(projected, 'stage'))).toEqual(['t2', 't3'])
    expect(frameOf(projected, 'root')?.members).toEqual(['t1', 't2', 't3', 'closed'])
  })

  it('stands found work in the frame of found work, never under no goal', () => {
    const projected = projectChain()
    expect(cardIds(frameOf(projected, FOUND_FRAME))).toEqual(['found-elsewhere', 'found-loose'])
    expect(frameOf(projected, NO_PARENT_FRAME)).toBeUndefined()
    // Control: the same items over a whole space put that work under no goal.
    const space = projectChain({ chainRootId: null })
    expect(cardIds(frameOf(space, NO_PARENT_FRAME))).toEqual(['found-elsewhere', 'found-loose'])
    // Its links are drawn as anywhere else: from the work it was found in, to it.
    expect(lines(projected)).toEqual([
      ['t1', 'found-elsewhere', 'discovered-from', 1],
      ['t2', 'found-loose', 'discovered-from', 1],
    ])
  })

  it('starts the root and its stages open however much they hold, the found band by the threshold', () => {
    const items = [...chainItems(), ...past('s', 300, 'stage'), ...past('f', 400)]
    const folded = (options: Partial<FrameProjectionInput> = {}) =>
      projectChain({ items, ...options }).frames.map((frame) => [frame.id, frame.folded])
    expect(folded()).toEqual([
      ['root', false],
      ['stage', false],
      [FOUND_FRAME, true],
    ])
    // Control: over the whole space the same goal and stage hold too much and start folded.
    expect(folded({ chainRootId: null })[0]).toEqual(['root', true])
    expect(folded({ chainRootId: null, choices: { root: false } })[1]).toEqual(['stage', true])
    // A choice the operator made still outranks the default.
    expect(folded({ choices: { stage: true } })[1]).toEqual(['stage', true])
    expect(folded({ choices: { root: true } })).toEqual([
      ['root', true],
      [FOUND_FRAME, true],
    ])
  })

  it('stands a goal found on the way, with its stage and work, in the band of found work', () => {
    const items = [
      ...chainItems(),
      item('found-goal', 70, { goal: true }),
      item('found-stage', 71, { goal: true, parent: 'found-goal' }),
      item('found-task', 72, { parent: 'found-stage' }),
    ]
    const projected = projectChain({ items })
    // Each frame is read after the frame it stands in, though the band is no goal.
    expect(projected.frames.map((frame) => [frame.id, frame.parentId])).toEqual([
      ['root', null],
      ['stage', 'root'],
      [FOUND_FRAME, null],
      ['found-goal', FOUND_FRAME],
      ['found-stage', 'found-goal'],
    ])
    expect(cardIds(frameOf(projected, 'found-stage'))).toEqual(['found-task'])
    expect(frameOf(projected, FOUND_FRAME)?.members).toEqual([
      'found-elsewhere',
      'found-loose',
      'found-task',
    ])
    expect(frameOf(projected, 'root')?.members).not.toContain('found-task')
    // Control: over the whole space the found goal stands on its own, beside the root.
    const space = projectChain({ items, chainRootId: null })
    expect(frameOf(space, 'found-goal')?.parentId).toBeNull()
  })

  it('draws the root when a filter finds nothing in it', () => {
    const projected = projectChain({ shown: new Set(['found-loose']) })
    expect(projected.frames.map((frame) => frame.id)).toEqual(['root', FOUND_FRAME])
    expect(projected.cards.map((entry) => entry.work_item_id)).toEqual(['found-loose'])
  })

  it('names no unread space for a link to work outside the chain', () => {
    expect(projectChain().unread).toEqual([])
    // Control: over a whole space the same link names a space the read did not read.
    expect(projectChain({ chainRootId: null }).unread).toEqual([''])
  })
})
