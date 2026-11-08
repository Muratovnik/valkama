/**
 * The field is laid out when its structure changes and only then. A frame of
 * the stream that changes a state, a holder or live work is laid on the placed
 * field by id: no layout, the same geometry, and whatever was lit stays lit.
 * A fold is structure: one layout, kept across a reload.
 */
import { effectScope, nextTick, reactive } from 'vue'

import type { ElkNode } from 'elkjs/lib/elk-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useGraphProjection } from '@/widgets/work-item-graph/composables/useGraphProjection.ts'
import type { LiveWork } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

/** Every layout asked for, on whichever worker, in order. */
const runs = vi.hoisted(() => [] as Array<{ graph: ElkNode; resolve: (graph: ElkNode) => void }>)

vi.mock('@/widgets/work-item-graph/utils/graphLayoutEngine.ts', () => ({
  createGraphLayoutEngine: () => ({
    terminateWorker: vi.fn(),
    layout: (graph: ElkNode) =>
      new Promise<ElkNode>((resolve) => {
        runs.push({ graph, resolve })
      }),
  }),
}))

const STATES = {
  todo: { state_id: 'todo', key: 'todo', name: 'Todo', category: 'queued', is_terminal: false },
  dev: { state_id: 'dev', key: 'dev', name: 'Dev', category: 'active', is_terminal: false },
} as const

function item(id: string, number: number, parent: string | null = null): WorkItemBrief {
  return {
    work_item_id: id,
    planning_space_id: 'space-1',
    reference: `MAIN-${number}`,
    number,
    title: `Item ${number}`,
    kind: parent === null && id.startsWith('epic') ? 'epic' : 'task',
    priority: 'medium',
    state: STATES.todo,
    claim_ref: '',
    claim_state: null,
    parent_id: parent,
    container: id.startsWith('epic'),
    ready: true,
    labels: [],
    source: '',
    checklist: [],
    revision: 0,
    created_at: '2026-10-22T10:00:00Z',
    updated_at: '2026-10-22T10:00:00Z',
    comment_count: 0,
  }
}

// An epic holding a and b, and c under none; a blocks c.
const space = () => [
  item('epic-1', 1),
  item('a', 2, 'epic-1'),
  item('b', 3, 'epic-1'),
  item('c', 4),
]
const links: PlanningEdge[] = [{ from: 'a', to: 'c', kind: 'blocks' }]

/** Every node placed, however deep, and every line given a route. */
function placeAll(node: ElkNode): ElkNode {
  return {
    ...node,
    x: 24,
    y: 24,
    width: node.width ?? 400,
    height: node.height ?? 200,
    children: node.children?.map((child) => placeAll(child)),
    edges: node.edges?.map((edge) => ({
      ...edge,
      sections: [{ id: `${edge.id}:route`, startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 } }],
    })),
  }
}

/** The nodes a request asks to place that hold nothing: cards and folded frames. */
const leaves = (node: ElkNode): string[] =>
  node.children?.length ? node.children.flatMap((child) => leaves(child)) : [node.id]

/** Every field a case opened, ended after it whether or not it passed. */
const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
})

async function settle() {
  for (let turn = 0; turn < 4; turn++) await Promise.resolve()
  await nextTick()
}

/** Answers the latest layout asked for. */
async function finish() {
  const run = runs.at(-1)
  if (!run) throw new Error('No layout was asked for')
  run.resolve(placeAll(run.graph))
  await settle()
}

function open() {
  const scope = effectScope()
  scopes.push(scope)
  const input = reactive({
    nodes: space(),
    edges: links,
    epicId: null,
    open: true,
    scopeKind: 'all' as const,
    space: 'space-1',
    version: 1,
    live: {} as Record<string, LiveWork>,
  })
  const projection = scope.run(() => useGraphProjection(() => input))
  if (!projection) throw new Error('Projection scope did not start')
  return { input, projection, scope }
}

describe('a frame that changes no structure', () => {
  beforeEach(() => {
    runs.length = 0
    localStorage.clear()
  })

  it.each([
    [
      'a claim',
      (entry: WorkItemBrief) => ({ ...entry, claim_ref: 'agent', claim_state: 'live' as const }),
    ],
    ['a state', (entry: WorkItemBrief) => ({ ...entry, state: STATES.dev })],
    ['a title', (entry: WorkItemBrief) => ({ ...entry, title: 'Renamed' })],
  ])(
    'with %s lays nothing out, keeps the geometry and lays the change on it',
    async (_, change) => {
      const { input, projection, scope } = open()
      await finish()
      const placed = projection.placed.value
      expect(runs).toHaveLength(1)
      input.nodes = input.nodes.map((entry) => (entry.work_item_id === 'a' ? change(entry) : entry))
      input.version = 2
      await settle()
      expect(runs).toHaveLength(1)
      expect(projection.placed.value).toBe(placed)
      const drawnA = projection.drawn.value?.nodes.find((node) => node.work_item_id === 'a')
      expect(drawnA).toMatchObject(change(item('a', 2, 'epic-1')))
      scope.stop()
    },
  )

  it('with live work lays nothing out, and hands the live work on', async () => {
    const { input, projection, scope } = open()
    await finish()
    input.live = { a: { state: 'working' } }
    input.version = 2
    await settle()
    expect(runs).toHaveLength(1)
    expect(projection.live.value).toEqual({ a: { state: 'working' } })
    scope.stop()
  })

  it('keeps a lit line lit', async () => {
    const { input, projection, scope } = open()
    await finish()
    projection.applyFocus({ type: 'focus', id: 'a' })
    expect(projection.focusSet.value?.ids.has('c')).toBe(true)
    input.nodes = input.nodes.map((entry) =>
      entry.work_item_id === 'a'
        ? { ...entry, claim_state: 'live' as const, claim_ref: 'agent' }
        : entry,
    )
    input.version = 2
    await settle()
    expect(projection.focusSet.value?.ids.has('c')).toBe(true)
    scope.stop()
  })

  it('counts a frame’s work afresh without a layout', async () => {
    const { input, projection, scope } = open()
    await finish()
    input.nodes = input.nodes.map((entry) =>
      entry.work_item_id === 'b' ? { ...entry, state: STATES.dev } : entry,
    )
    await settle()
    expect(runs).toHaveLength(1)
    expect(projection.frames.value.find((frame) => frame.id === 'epic-1')?.progress).toMatchObject({
      active: 1,
      ahead: 1,
    })
    scope.stop()
  })
})

/** A field whose items a filter narrowed, with the whole space beside them. */
function filtered(nodes: (all: WorkItemBrief[]) => WorkItemBrief[], extra: WorkItemBrief[] = []) {
  const scope = effectScope()
  scopes.push(scope)
  const all = [...space(), ...extra]
  const input = reactive({
    nodes: nodes(all),
    spaceItems: all,
    edges: links,
    epicId: null,
    open: true,
    scopeKind: 'all' as const,
    space: 'space-1',
    version: 1,
  })
  const projection = scope.run(() => useGraphProjection(() => input))
  if (!projection) throw new Error('Projection scope did not start')
  return { projection, scope }
}

describe('a filter beside the whole space', () => {
  beforeEach(() => {
    runs.length = 0
    localStorage.clear()
  })

  it('narrows nothing when it lets everything through, though the array is new', async () => {
    // An open epic with nothing under it is drawn folded unless a filter narrows the field.
    const { scope } = filtered((all) => [...all], [item('epic-2', 5)])
    await settle()
    expect(leaves(runs[0].graph)).toEqual(['a', 'b', 'c', 'epic-2'])
    scope.stop()
  })

  it('draws only what it let through, and a frame still counts its epic’s work', async () => {
    const { projection, scope } = filtered((all) =>
      all.filter((entry) => entry.work_item_id === 'b'),
    )
    await finish()
    expect(leaves(runs[0].graph)).toEqual(['b'])
    expect(projection.frames.value.map((frame) => [frame.id, frame.progress.total])).toEqual([
      ['epic-1', 2],
    ])
    scope.stop()
  })
})

describe('folding a frame', () => {
  beforeEach(() => {
    runs.length = 0
    localStorage.clear()
  })
  afterEach(() => vi.restoreAllMocks())

  it('lays the field out once and is kept across a reload', async () => {
    const first = open()
    await finish()
    expect(leaves(runs[0].graph)).toEqual(['a', 'b', 'c'])
    first.projection.toggle('epic-1')
    await settle()
    expect(runs).toHaveLength(2)
    expect(leaves(runs[1].graph)).toEqual(['epic-1', 'c'])
    expect(first.projection.folded('epic-1')).toBe(true)
    first.scope.stop()

    runs.length = 0
    const again = open()
    await settle()
    expect(leaves(runs[0].graph)).toEqual(['epic-1', 'c'])
    expect(again.projection.folded('epic-1')).toBe(true)
    again.scope.stop()
  })

  it('forgets a choice that matches what the frame would be untouched', async () => {
    const { projection, scope } = open()
    await finish()
    projection.toggle('epic-1')
    await settle()
    expect(localStorage.getItem('valkama-graph-frames')).toContain('epic-1')
    projection.toggle('epic-1')
    await settle()
    expect(projection.folded('epic-1')).toBe(false)
    expect(localStorage.getItem('valkama-graph-frames')).not.toContain('epic-1')
    scope.stop()
  })

  it('stores nothing and lays nothing out for a frame with nothing to unfold', async () => {
    const { projection, scope } = filtered((all) => [...all], [item('epic-2', 5)])
    await settle()
    const before = runs.length
    projection.toggle('epic-2')
    await settle()
    expect(runs).toHaveLength(before)
    expect(projection.folded('epic-2')).toBe(true)
    expect(localStorage.getItem('valkama-graph-frames') ?? '').not.toContain('epic-2')
    scope.stop()
  })

  it('keeps the choice for the page when storage refuses it', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const first = open()
    await finish()
    first.projection.toggle('epic-1')
    await settle()
    expect(first.projection.folded('epic-1')).toBe(true)
    expect(leaves(runs.at(-1)?.graph ?? { id: '' })).toEqual(['epic-1', 'c'])
    first.scope.stop()
  })
})
