/**
 * Which frames a space's graph draws, what each counts, and which lines run
 * between what is drawn. The small space below names each rule's case by hand;
 * the broad space checks the same rules hold over a space of real size.
 */
import { describe, expect, it } from 'vitest'

import { FOLD_ABOVE, frameProjection } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import type { FrameProjectionInput } from '@/widgets/work-item-graph/utils/graphFrames.ts'
import { NO_EPIC_FRAME } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

import { broadSpace } from './fixtures/graphSpaces.ts'

const STATES = {
  todo: { state_id: 'todo', key: 'todo', name: 'Todo', category: 'queued', is_terminal: false },
  dev: { state_id: 'dev', key: 'dev', name: 'Dev', category: 'active', is_terminal: false },
  done: { state_id: 'done', key: 'done', name: 'Done', category: 'completed', is_terminal: true },
} as const

const ids = {
  E1: 'e1', // open epic: a1, a2, and the nested epic E4
  E2: 'e2', // open epic: b1, b2 (finished), b3
  E3: 'e3', // finished epic still holding c1
  E4: 'e4', // epic inside E1, holding d1
}

function item(
  id: string,
  number: number,
  options: { epic?: boolean; parent?: string; state?: keyof typeof STATES } = {},
): WorkItemBrief {
  return {
    work_item_id: id,
    planning_space_id: 'space',
    reference: `MAIN-${number}`,
    number,
    title: `Item ${number}`,
    kind: options.epic ? 'epic' : 'task',
    priority: 'medium',
    state: STATES[options.state ?? 'todo'],
    claim_ref: '',
    claim_state: null,
    parent_id: options.parent ?? null,
    container: false,
    ready: true,
    labels: [],
    source: '',
    checklist: [],
    revision: 0,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    comment_count: 0,
  }
}

function space(): WorkItemBrief[] {
  const items = [
    item(ids.E1, 1, { epic: true }),
    item(ids.E2, 2, { epic: true }),
    item(ids.E3, 3, { epic: true, state: 'done' }),
    item(ids.E4, 4, { epic: true, parent: ids.E1 }),
    item('a1', 11, { parent: ids.E1 }),
    item('a2', 12, { parent: ids.E1, state: 'dev' }),
    item('b1', 21, { parent: ids.E2 }),
    item('b2', 22, { parent: ids.E2, state: 'done' }),
    item('b3', 23, { parent: ids.E2 }),
    item('c1', 31, { parent: ids.E3 }),
    item('d1', 41, { parent: ids.E4 }),
    item('l1', 51),
  ]
  const parents = new Set(items.map((entry) => entry.parent_id))
  return items.map((entry) => ({ ...entry, container: parents.has(entry.work_item_id) }))
}

const link = (from: string, to: string, kind: PlanningEdge['kind'] = 'discovered-from') => ({
  from,
  to,
  kind,
})

function project(links: PlanningEdge[], options: Partial<FrameProjectionInput> = {}) {
  return frameProjection({ items: space(), links, showDone: false, ...options })
}

const lines = (projected: ReturnType<typeof project>) =>
  projected.edges.map((edge) => [edge.source, edge.target, edge.kind, edge.links.length])

describe('lines between what is drawn', () => {
  it.each([
    [
      'to another epic ends on its frame',
      [link('a1', ids.E2)],
      {},
      [['a1', ids.E2, 'discovered-from', 1]],
    ],
    ['to its own epic draws nothing', [link('a1', ids.E1)], {}, []],
    ['to the epic round its own epic draws nothing', [link('d1', ids.E1)], {}, []],
    ['to hidden finished work draws nothing', [link('a1', 'b2')], {}, []],
    [
      'to finished work in «All» is drawn',
      [link('a1', 'b2')],
      { showDone: true },
      [['a1', 'b2', 'discovered-from', 1]],
    ],
    ['to another space draws nothing', [link('a1', 'elsewhere', 'blocks')], {}, []],
    ['a parent edge is never a line', [link(ids.E2, 'b1', 'parent')], {}, []],
    [
      'into a folded frame lands on it, two links one solid line',
      [link('a1', 'b1'), link('a1', 'b3', 'blocks')],
      { choices: { [ids.E2]: true } },
      [['a1', ids.E2, 'blocks', 2]],
    ],
    [
      'two links into a folded frame that do not block stay one dashed line',
      [link('a1', 'b1'), link('a1', 'b3', 'relates-to')],
      { choices: { [ids.E2]: true } },
      [['a1', ids.E2, 'discovered-from', 2]],
    ],
    [
      'inside one folded frame draws nothing',
      [link('b1', 'b3', 'blocks')],
      { choices: { [ids.E2]: true } },
      [],
    ],
    [
      'a nested card in a folded frame lands on the outer frame',
      [link('d1', 'b1')],
      { choices: { [ids.E1]: true } },
      [[ids.E1, 'b1', 'discovered-from', 1]],
    ],
    [
      'each way round keeps its own arrow',
      [link('a1', 'b1', 'blocks'), link('b1', 'a1')],
      {},
      [
        ['a1', 'b1', 'blocks', 1],
        ['b1', 'a1', 'discovered-from', 1],
      ],
    ],
  ] as const)('a link %s', (_, links, options, expected) => {
    const projected = project([...links], options)
    expect(lines(projected)).toEqual(expected)
  })
})

describe('frames and what they count', () => {
  it('counts every item under an epic, nested work included, whatever a filter lets through', () => {
    const whole = project([])
    const filtered = project([], { shown: new Set(['a1']) })
    const progress = (projected: ReturnType<typeof project>, id: string) =>
      projected.frames.find((frame) => frame.id === id)?.progress
    expect(progress(whole, ids.E1)).toEqual({
      active: 1,
      ahead: 2,
      blocked: 0,
      done: 0,
      review: 0,
      total: 3,
    })
    expect(progress(filtered, ids.E1)).toEqual(progress(whole, ids.E1))
    expect(progress(whole, ids.E2)).toMatchObject({ done: 1, ahead: 2, total: 3 })
  })

  it('draws a finished epic that still holds open work, and a nested epic inside its own', () => {
    const projected = project([])
    const frame = (id: string) => projected.frames.find((entry) => entry.id === id)
    expect(frame(ids.E3)?.cards.map((entry) => entry.work_item_id)).toEqual(['c1'])
    expect(frame(ids.E4)?.parentId).toBe(ids.E1)
    expect(frame(ids.E1)?.members).toEqual(['a1', 'a2', 'd1'])
    // A frame comes after the frame it stands in.
    const order = projected.frames.map((entry) => entry.id)
    expect(order.indexOf(ids.E4)).toBeGreaterThan(order.indexOf(ids.E1))
    expect(order.at(-1)).toBe(NO_EPIC_FRAME)
  })

  it('under a filter draws only the frames it found something in', () => {
    const projected = project([], { shown: new Set(['b1', 'd1']) })
    expect(projected.frames.map((frame) => frame.id)).toEqual([ids.E1, ids.E2, ids.E4])
    expect(projected.cards.map((entry) => entry.work_item_id)).toEqual(['b1', 'd1'])
  })

  it('folds a frame above the threshold and one with nothing open; a choice overrides', () => {
    const many = Array.from({ length: FOLD_ABOVE + 1 }, (_, index) =>
      item(`m${index}`, 100 + index, { parent: ids.E2 }),
    )
    const items = [...space(), ...many]
    const folded = (choices = {}) =>
      frameProjection({ items, links: [], showDone: false, choices }).frames.map((frame) => [
        frame.id,
        frame.folded,
      ])
    expect(folded()).toEqual([
      [ids.E1, false],
      [ids.E2, true],
      [ids.E3, false],
      [ids.E4, false],
      [NO_EPIC_FRAME, false],
    ])
    expect(folded({ [ids.E2]: false, [ids.E1]: true })).toEqual([
      [ids.E1, true],
      [ids.E2, false],
      [ids.E3, false],
      [NO_EPIC_FRAME, false],
    ])
  })
})

/** `count` finished items under no epic. */
const finished = (count: number) =>
  Array.from({ length: count }, (_, index) => item(`f${index}`, 200 + index, { state: 'done' }))

/** Whether the frame of the work under none is folded; undefined when it is not drawn. */
const noneFolded = (count: number, showDone: boolean) =>
  frameProjection({
    items: [...space(), ...finished(count)].filter((entry) => entry.work_item_id !== 'l1'),
    links: [],
    showDone,
  }).frames.find((frame) => frame.id === NO_EPIC_FRAME)?.folded

describe('the work under none with nothing open', () => {
  it('is drawn open in «All» while its finished work is small, and folds past the threshold', () => {
    expect(noneFolded(3, true)).toBe(false)
    expect(noneFolded(FOLD_ABOVE + 1, true)).toBe(true)
  })

  it('is not drawn in «Open» at all', () => {
    expect(noneFolded(3, false)).toBeUndefined()
  })
})

describe('the structural key', () => {
  const base = () => frameProjection({ items: space(), links: [link('a1', 'b1')], showDone: false })
  const change = (
    edit: (items: WorkItemBrief[]) => WorkItemBrief[],
    extra: Partial<FrameProjectionInput> = {},
  ) =>
    frameProjection({ items: edit(space()), links: [link('a1', 'b1')], showDone: false, ...extra })
      .key

  it.each([
    [
      'a state within the open work',
      (items: WorkItemBrief[]) =>
        items.map((entry) =>
          entry.work_item_id === 'a1' ? { ...entry, state: STATES.dev } : entry,
        ),
    ],
    [
      'a holder and its claim',
      (items: WorkItemBrief[]) =>
        items.map((entry) =>
          entry.work_item_id === 'a1'
            ? { ...entry, claim_ref: 'agent', claim_state: 'live' as const }
            : entry,
        ),
    ],
    [
      'a title',
      (items: WorkItemBrief[]) => items.map((entry) => ({ ...entry, title: `${entry.title}!` })),
    ],
  ])('does not move for %s', (_, edit) => {
    expect(change(edit)).toBe(base().key)
  })

  it.each([
    ['a fold', { choices: { [ids.E1]: true } }],
    ['«All»', { showDone: true }],
    ['a new link', { links: [link('a1', 'b1'), link('a2', 'b3', 'blocks')] }],
    ['a link that starts blocking', { links: [link('a1', 'b1', 'blocks')] }],
  ] as const)('moves for %s', (_, extra) => {
    expect(change((items) => items, extra)).not.toBe(base().key)
  })
})

describe('the broad space', () => {
  const { model, lone, epics } = broadSpace()
  const projected = frameProjection({
    items: model.work_items,
    links: model.links,
    showDone: false,
  })

  it('loses no open work: drawn cards and the open work of folded frames add up to all of it', () => {
    const folded = projected.frames.filter((frame) => frame.folded)
    const hidden = folded.reduce((sum, frame) => sum + frame.open, 0)
    expect(projected.cards.length + hidden).toBe(311)
    expect(projected.cards).toHaveLength(132)
  })

  it('folds the work under none, the largest epic and the open epics with nothing open', () => {
    const folded = projected.frames.filter((frame) => frame.folded).map((frame) => frame.id)
    expect(folded.toSorted()).toEqual(
      [
        NO_EPIC_FRAME,
        epics[0].work_item_id,
        ...epics
          .filter((epic) => epic.title.startsWith('An open stream'))
          .map((epic) => epic.work_item_id),
      ].toSorted(),
    )
    expect(projected.frames).toHaveLength(46)
  })

  it('shows the item whose only link is to its own epic, inside that epic, open', () => {
    const frame = projected.frames.find((entry) => entry.id === lone?.epic.work_item_id)
    expect(frame?.folded).toBe(false)
    expect(frame?.cards.map((entry) => entry.work_item_id)).toContain(lone?.item.work_item_id)
    const touching = projected.edges.filter((edge) =>
      edge.links.some(
        (entry) => entry.from === lone?.item.work_item_id || entry.to === lone?.item.work_item_id,
      ),
    )
    expect(touching).toHaveLength(0)
  })

  it('draws every link from open work to another drawn epic as a line to its frame', () => {
    const drawn = new Set(projected.frames.map((frame) => frame.id))
    const epicIds = new Set(epics.map((epic) => epic.work_item_id))
    const byId = new Map(model.work_items.map((entry) => [entry.work_item_id, entry]))
    const foreign = model.links.filter((entry) => {
      const [work, epic] = epicIds.has(entry.to) ? [entry.from, entry.to] : [entry.to, entry.from]
      const card = byId.get(work)
      return (
        epicIds.has(epic) &&
        drawn.has(epic) &&
        card !== undefined &&
        !card.container &&
        !card.state.is_terminal &&
        card.parent_id !== epic
      )
    })
    expect(foreign.length).toBeGreaterThan(0)
    for (const entry of foreign) {
      const line = projected.edges.find((edge) =>
        edge.links.some((one) => one.from === entry.from && one.to === entry.to),
      )
      expect(line, `${entry.from} → ${entry.to}`).toBeDefined()
      expect([line?.source, line?.target]).toContain(epicIds.has(entry.to) ? entry.to : entry.from)
    }
  })
})
