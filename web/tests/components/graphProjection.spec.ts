import { effectScope, nextTick, reactive, ref } from 'vue'

import type { ElkNode } from 'elkjs/lib/elk-api'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useGraphProjection } from '@/widgets/work-item-graph/composables/useGraphProjection.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

const workers = vi.hoisted(
  () =>
    [] as Array<{
      graph: ElkNode | null
      terminateWorker: ReturnType<typeof vi.fn>
      reject: (error: Error) => void
      resolve: (graph: ElkNode) => void
    }>,
)

vi.mock('@/widgets/work-item-graph/utils/graphLayoutEngine.ts', () => ({
  createGraphLayoutEngine: () => {
    const worker = {
      graph: null as ElkNode | null,
      resolve: (_: ElkNode) => {},
      reject: (_: Error) => {},
      terminateWorker: vi.fn(),
    }
    workers.push(worker)
    return {
      terminateWorker: worker.terminateWorker,
      layout: (graph: ElkNode) => {
        worker.graph = graph
        return new Promise<ElkNode>((resolve, reject) => {
          worker.resolve = resolve
          worker.reject = reject
        })
      },
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

function finish(index: number) {
  const worker = workers[index]
  const graph = worker.graph
  if (!graph) throw new Error('Worker received no graph')
  worker.resolve({
    ...graph,
    width: 400,
    height: 200,
    children: graph.children?.map((node) => ({ ...node, x: 24, y: 24 })),
  })
}

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

describe('graph worker lifecycle', () => {
  beforeEach(() => {
    workers.length = 0
  })
  afterEach(() => vi.useRealTimers())

  it('releases superseded workers and rejects stale scope results', async () => {
    const { input, projection, scope } = openProjection()
    input.space = 'space-2'
    input.nodes = [{ ...item, work_item_id: 'work-2', reference: 'TEST-2' }]
    await nextTick()
    expect(workers[0].terminateWorker).toHaveBeenCalled()
    finish(0)
    await settle()
    expect(projection.placed.value).toBeNull()
    finish(1)
    await settle()
    expect(projection.placed.value?.nodes[0].work_item_id).toBe('work-2')
    expect(projection.pending.value).toBe(false)
    expect(workers[1].terminateWorker).toHaveBeenCalled()
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
    selected.value = 'missing'
    expect(projection.focusSet.value).toBeNull()
    scope.stop()
  })

  it('keeps a same-scope projection during refresh and reports a failed refresh', async () => {
    const { input, projection, scope } = openProjection()
    finish(0)
    await settle()
    const previous = projection.placed.value
    input.nodes = [{ ...item, title: 'Changed title' }]
    await nextTick()
    expect(projection.placed.value).toBe(previous)
    workers[1].reject(new Error('worker failed'))
    await settle()
    expect(projection.failed.value).toBe(true)
    expect(projection.pending.value).toBe(false)
    expect(projection.placed.value).toBe(previous)
    expect(workers[1].terminateWorker).toHaveBeenCalled()
    scope.stop()
  })

  it('bounds a stalled worker, supports explicit retry, and releases pending work on disposal', async () => {
    vi.useFakeTimers()
    const { projection, scope } = openProjection()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(projection.pending.value).toBe(false)
    expect(projection.failed.value).toBe(true)
    expect(workers[0].terminateWorker).toHaveBeenCalled()
    projection.retry()
    await nextTick()
    expect(projection.pending.value).toBe(true)
    expect(projection.failed.value).toBe(false)
    finish(1)
    await settle()
    expect(projection.placed.value?.nodes).toHaveLength(1)
    projection.retry()
    await nextTick()
    scope.stop()
    expect(workers[2].terminateWorker).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})
