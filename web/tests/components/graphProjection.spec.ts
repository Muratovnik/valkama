import { effectScope, nextTick, reactive, ref } from 'vue'

import type { ElkNode } from 'elkjs/lib/elk-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useGraphProjection } from '@/widgets/work-item-graph/composables/useGraphProjection.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

/** One request a worker was given, answered when the test says so. */
type Run = {
  graph: ElkNode
  reject: (error: Error) => void
  resolve: (graph: ElkNode) => void
}

/** Every worker started, in order, each with the layouts it was asked for. */
const workers = vi.hoisted(
  () => [] as Array<{ runs: Run[]; terminateWorker: ReturnType<typeof vi.fn> }>,
)

vi.mock('@/widgets/work-item-graph/utils/graphLayoutEngine.ts', () => ({
  createGraphLayoutEngine: () => {
    const worker = { runs: [] as Run[], terminateWorker: vi.fn() }
    workers.push(worker)
    return {
      terminateWorker: worker.terminateWorker,
      layout: (graph: ElkNode) =>
        new Promise<ElkNode>((resolve, reject) => {
          worker.runs.push({ graph, resolve, reject })
        }),
    }
  },
}))

const item: WorkItemBrief = {
  work_item_id: 'work-1',
  planning_space_id: 'space-1',
  reference: 'TEST-1',
  number: 1,
  title: 'Readable work',
  kind: 'task',
  priority: 'medium',
  state: { state_id: 'todo', key: 'todo', name: 'Todo', category: 'queued', is_terminal: false },
  claim_ref: '',
  claim_state: null,
  parent_id: null,
  container: false,
  ready: true,
  labels: [],
  source: '',
  checklist: [],
  revision: 0,
  created_at: '2026-10-22T10:00:00Z',
  updated_at: '2026-10-22T10:00:00Z',
  comment_count: 0,
}

const second = { ...item, work_item_id: 'work-2', reference: 'TEST-2' }
const third = { ...item, work_item_id: 'work-3', reference: 'TEST-3' }

function openProjection() {
  const scope = effectScope()
  const input = reactive({
    nodes: [item],
    edges: [],
    epicId: null,
    open: true,
    scopeKind: 'all' as const,
    space: 'space-1',
    version: 1,
  })
  const selected = ref<string | null>(null)
  const projection = scope.run(() =>
    useGraphProjection(
      () => input,
      () => selected.value,
    ),
  )
  if (!projection) throw new Error('Projection scope did not start')
  return { scope, input, projection, selected }
}

/** The worker's latest request, or the one named. */
function run(index: number, which = -1): Run {
  const found = workers[index]?.runs.at(which)
  if (!found) throw new Error(`Worker ${index} received no graph`)
  return found
}

/**
 * Every node placed, however deep the frames nest it, and every line given a
 * route: a frame or a block of cards takes the size of the field.
 */
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

/** Answers a worker's request with every node placed. */
function finish(index: number, which = -1) {
  const { graph, resolve } = run(index, which)
  resolve(placeAll(graph))
}

/** The cards a request asks to place: the nodes that hold nothing. */
function cardIds(node: ElkNode): string[] {
  return node.children?.length ? node.children.flatMap((child) => cardIds(child)) : [node.id]
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

const drawnIds = (projection: ReturnType<typeof openProjection>['projection']) =>
  projection.placed.value?.nodes.map((node) => node.work_item_id)

describe('graph worker lifecycle', () => {
  beforeEach(() => {
    workers.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('lays out one graph after another on the one worker it keeps', async () => {
    const { input, projection, scope } = openProjection()
    finish(0)
    await settle()
    expect(drawnIds(projection)).toEqual(['work-1'])
    input.nodes = [second]
    await nextTick()
    // The second layout goes to the worker that drew the first: no new worker loads ELK.
    expect(workers).toHaveLength(1)
    expect(workers[0].runs).toHaveLength(2)
    finish(0)
    await settle()
    expect(drawnIds(projection)).toEqual(['work-2'])
    expect(projection.pending.value).toBe(false)
    expect(workers[0].terminateWorker).not.toHaveBeenCalled()
    scope.stop()
  })

  it('ends a worker busy with a superseded layout and starts the new one at once', async () => {
    const { input, projection, scope } = openProjection()
    input.space = 'space-2'
    input.nodes = [second]
    await nextTick()
    // The stale layout is not finished first: its worker ends, and the new layout is
    // already on a fresh worker while the stale one has not answered.
    expect(workers[0].terminateWorker).toHaveBeenCalledOnce()
    expect(workers).toHaveLength(2)
    expect(cardIds(run(1).graph)).toEqual(['work-2'])
    // An answer the ended worker still gives never reaches the field.
    finish(0)
    await settle()
    expect(projection.placed.value).toBeNull()
    expect(projection.pending.value).toBe(true)
    finish(1)
    await settle()
    expect(drawnIds(projection)).toEqual(['work-2'])
    expect(projection.pending.value).toBe(false)
    // The fresh worker is the one kept: the next layout reuses it.
    input.nodes = [third]
    await nextTick()
    expect(workers).toHaveLength(2)
    expect(workers[1].terminateWorker).not.toHaveBeenCalled()
    finish(1)
    await settle()
    expect(drawnIds(projection)).toEqual(['work-3'])
    scope.stop()
  })

  it('retains selected context after hover leaves without triggering a layout', async () => {
    const { projection, selected, scope } = openProjection()
    finish(0)
    await settle()
    selected.value = item.work_item_id
    expect(projection.focusSet.value?.ids.has(item.work_item_id)).toBe(true)
    projection.applyFocus({ type: 'pointer-enter', id: item.work_item_id })
    projection.applyFocus({ type: 'pointer-leave', id: item.work_item_id })
    expect(projection.focusSet.value?.ids.has(item.work_item_id)).toBe(true)
    expect(workers).toHaveLength(1)
    expect(workers[0].runs).toHaveLength(1)
    selected.value = 'missing'
    expect(projection.focusSet.value).toBeNull()
    scope.stop()
  })

  it('keeps a same-scope projection when a refresh fails, and retries on a fresh worker', async () => {
    const { input, projection, scope } = openProjection()
    finish(0)
    await settle()
    const previous = projection.placed.value
    input.nodes = [{ ...item, title: 'Changed title' }]
    await nextTick()
    expect(projection.placed.value).toBe(previous)
    expect(workers).toHaveLength(1)
    run(0).reject(new Error('worker failed'))
    await settle()
    expect(projection.failed.value).toBe(true)
    expect(projection.pending.value).toBe(false)
    expect(projection.placed.value).toBe(previous)
    // The worker that failed is not trusted with the retry.
    expect(workers[0].terminateWorker).toHaveBeenCalledOnce()
    projection.retry()
    await nextTick()
    expect(workers).toHaveLength(2)
    finish(1)
    await settle()
    expect(projection.failed.value).toBe(false)
    expect(projection.placed.value?.nodes[0].title).toBe('Changed title')
    scope.stop()
  })

  it('ends a stalled worker after 30 s and lets retry start a fresh one', async () => {
    vi.useFakeTimers()
    const { projection, scope } = openProjection()
    await vi.advanceTimersByTimeAsync(29_999)
    expect(projection.pending.value).toBe(true)
    expect(workers[0].terminateWorker).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(projection.pending.value).toBe(false)
    expect(projection.failed.value).toBe(true)
    expect(workers[0].terminateWorker).toHaveBeenCalledOnce()
    // The stalled worker's late answer lands nowhere.
    finish(0)
    await settle()
    expect(projection.placed.value).toBeNull()
    projection.retry()
    await nextTick()
    expect(projection.pending.value).toBe(true)
    expect(projection.failed.value).toBe(false)
    expect(workers).toHaveLength(2)
    finish(1)
    await settle()
    expect(projection.placed.value?.nodes).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
    scope.stop()
  })

  it('ends the kept worker when the field goes, idle or busy, and leaves no timer', async () => {
    vi.useFakeTimers()
    const idle = openProjection()
    finish(0)
    await settle()
    // Idle between layouts, the worker stays for the next one ...
    expect(workers[0].terminateWorker).not.toHaveBeenCalled()
    idle.scope.stop()
    // ... and goes with the field.
    expect(workers[0].terminateWorker).toHaveBeenCalledOnce()

    const busy = openProjection()
    expect(vi.getTimerCount()).toBe(1)
    busy.scope.stop()
    expect(workers[1].terminateWorker).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    finish(1)
    await settle()
    expect(busy.projection.placed.value).toBeNull()
  })
})
