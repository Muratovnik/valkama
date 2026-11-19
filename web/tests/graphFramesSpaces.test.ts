/**
 * The frames of a goal five levels deep, and the frames of other spaces: another space's
 * cards and the far ends of the links with it stand in that space's frame, one a space,
 * after this space's frames; a link to such a card is drawn to it, and a link whose end the
 * read could not read is not drawn and names its space.
 */
import { describe, expect, it } from 'vitest'

import { frameProjection } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import type { FrameProjectionInput } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import { NO_PARENT_FRAME, spaceFrameId } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import { otherSpaceEndBrief } from '@/entities/work-item/utils/otherSpaceEnds.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

const TODO = {
  state_id: 'todo',
  key: 'todo',
  name: 'Todo',
  category: 'ready',
  is_terminal: false,
} as const
const ALPHA = { key: 'ALPHA', name: 'Alpha' }
const BETA = { key: 'BETA', name: 'Beta' }

function item(
  id: string,
  number: number,
  options: { kind?: WorkItemBrief['kind']; parent?: string; space?: typeof ALPHA } = {},
): WorkItemBrief {
  return {
    work_item_id: id,
    planning_space_id: options.space ? 'elsewhere' : 'space',
    reference: `${options.space?.key ?? 'MAIN'}-${number}`,
    number,
    title: `Item ${number}`,
    kind: options.kind ?? 'task',
    priority: 'medium',
    state: TODO,
    open: true,
    container_state: null,
    acceptance: null,
    started_at: null,
    waits_for: [],
    claim_ref: '',
    claim_state: null,
    parent_id: options.parent ?? null,
    labels: [],
    projects: [],
    other_space: options.space ?? null,
    source: '',
    checklist: [],
    revision: 0,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    workable: true,
    withheld: [],
    lapsed_claim: null,
    comment_count: 0,
  }
}

const link = (
  from: string,
  to: string,
  kind: PlanningEdge['kind'] = 'blocks',
  reference?: string,
) => ({ from, to, kind, ...(reference ? { reference } : {}) }) as PlanningEdge

const project = (
  items: WorkItemBrief[],
  links: PlanningEdge[] = [],
  more: Partial<FrameProjectionInput> = {},
) => frameProjection({ items, links, showDone: false, ...more })

/** A goal, four stages each inside the one before, and a task in the deepest. */
const LEVELS = ['g1', 's2', 's3', 's4', 's5']
function fiveLevels(): WorkItemBrief[] {
  return [
    ...LEVELS.map((id, depth) =>
      item(id, depth + 1, { kind: depth ? 'stage' : 'goal', parent: LEVELS[depth - 1] }),
    ),
    item('t6', 6, { parent: 's5' }),
  ]
}

describe('a goal five levels deep', () => {
  it('draws a frame on every level, each inside the one above it, and the task in the deepest', () => {
    const projected = project(fiveLevels())
    expect(projected.frames.map((frame) => [frame.id, frame.parentId, frame.folded])).toEqual([
      ['g1', null, false],
      ['s2', 'g1', false],
      ['s3', 's2', false],
      ['s4', 's3', false],
      ['s5', 's4', false],
    ])
    expect(
      projected.frames.find((frame) => frame.id === 's5')?.cards.map((c) => c.reference),
    ).toEqual(['MAIN-6'])
    // Each frame counts the task under it, however deep.
    expect(projected.frames.map((frame) => frame.progress.total)).toEqual([1, 1, 1, 1, 1])
  })

  it('folded at the top, draws the goal alone, and a link into the deepest task lands on it', () => {
    const items = [...fiveLevels(), item('l7', 7)]
    const projected = project(items, [link('l7', 't6')], { choices: { g1: true } })
    expect(projected.frames.map((frame) => frame.id)).toEqual(['g1', NO_PARENT_FRAME])
    expect(projected.edges.map((edge) => [edge.source, edge.target])).toEqual([['l7', 'g1']])
  })
})

/** This space's task, another space's task under a goal of its own space, its goal, and an end. */
function withSpaces() {
  const end = otherSpaceEndBrief({
    work_item_id: 'b1',
    reference: 'BETA-4',
    title: 'Elsewhere',
    kind: 'task',
    state: { key: 'todo', name: 'Todo', category: 'ready', is_terminal: false },
    space: BETA,
  })
  return [
    item('g1', 1, { kind: 'goal' }),
    item('t2', 2, { parent: 'g1' }),
    item('t3', 3),
    item('a7', 7, { parent: 'a-goal', space: ALPHA }),
    item('a8', 8, { kind: 'goal', space: ALPHA }),
    end,
  ]
}

describe('another space’s work', () => {
  it('stands in a frame of its space, one a space, after this space’s frames, the spaces by key', () => {
    const projected = project(withSpaces())
    expect(projected.frames.map((frame) => [frame.id, frame.space?.key ?? null])).toEqual([
      ['g1', null],
      [NO_PARENT_FRAME, null],
      [spaceFrameId('ALPHA'), 'ALPHA'],
      [spaceFrameId('BETA'), 'BETA'],
    ])
    const alpha = projected.frames.find((frame) => frame.id === spaceFrameId('ALPHA'))
    // Its goal is a card there: it holds nothing in this space.
    expect(alpha?.cards.map((card) => card.reference)).toEqual(['ALPHA-7', 'ALPHA-8'])
    expect(alpha?.goal).toBeNull()
    expect(alpha?.parentId).toBeNull()
    // The work under no goal holds only this space's.
    expect(
      projected.frames.find((frame) => frame.id === NO_PARENT_FRAME)?.cards.map((c) => c.reference),
    ).toEqual(['MAIN-3'])
  })

  it('draws a link to a card of another space to that card, and to its frame when it is folded', () => {
    const links = [link('t2', 'b1'), link('a7', 't3', 'relates-to')]
    expect(project(withSpaces(), links).edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['a7', 't3'],
      ['t2', 'b1'],
    ])
    const folded = project(withSpaces(), links, { choices: { [spaceFrameId('BETA')]: true } })
    expect(folded.edges.map((edge) => [edge.source, edge.target])).toEqual([
      ['a7', 't3'],
      ['t2', spaceFrameId('BETA')],
    ])
    expect(folded.unread).toEqual([])
  })

  it('leaves out every frame of another space when the filter leaves out their work', () => {
    const items = withSpaces()
    const own = new Set(items.filter((entry) => !entry.other_space).map((own) => own.work_item_id))
    const projected = project(items, [link('t2', 'b1')], { shown: own })
    expect(projected.frames.map((frame) => frame.id)).toEqual(['g1', NO_PARENT_FRAME])
    expect(projected.edges).toEqual([])
  })
})

describe('a link whose end the read could not read', () => {
  it('is not drawn, and names the space of its source by the reference the link carries', () => {
    const links = [link('gone', 't3', 'blocks', 'GAMMA-12'), link('t3', 'lost', 'relates-to')]
    const projected = project(withSpaces(), links)
    expect(projected.edges).toEqual([])
    // A target is named by nothing, so its space is said as another one.
    expect(projected.unread).toEqual(['', 'GAMMA'])
  })

  it('names nothing when every end is read, a parent edge included', () => {
    expect(project(withSpaces(), [link('g1', 't2', 'parent'), link('t2', 'b1')]).unread).toEqual([])
  })
})
