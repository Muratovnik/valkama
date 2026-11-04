/**
 * The graph's layout worker is started when the page knows the graph is coming,
 * and the field's first layout runs on it: no second worker loads ELK, a spare
 * nobody takes is ended, and nothing is warmed while a field holds its own.
 *
 * The spare is module state, so every case starts from fresh modules.
 */
import ELK from 'elkjs/lib/elk.bundled.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Every engine the factory made, in order, with what it was asked to lay out. */
const engines = vi.hoisted(
  () =>
    [] as Array<{
      layouts: Array<{ reject: (error: Error) => void; resolve: (graph: object) => void }>
      terminateWorker: ReturnType<typeof vi.fn>
    }>,
)

vi.mock('@/widgets/work-item-graph/utils/graphLayoutEngine.ts', () => ({
  createGraphLayoutEngine: () => {
    const engine = { layouts: [] as (typeof engines)[number]['layouts'], terminateWorker: vi.fn() }
    engines.push(engine)
    return {
      terminateWorker: engine.terminateWorker,
      layout: () =>
        new Promise((resolve, reject) => {
          engine.layouts.push({ resolve, reject })
        }),
    }
  },
}))

// The view itself is Vue Flow and more; prefetching it is not what is measured here.
vi.mock('@/widgets/work-item-graph/components/GraphView.vue', () => ({ default: {} }))

async function load() {
  const { graphView } = await import('@/pages/planning/utils/graphView.ts')
  const { createGraphLayoutRunner } =
    await import('@/widgets/work-item-graph/utils/graphLayoutRunner.ts')
  const warm = await import('@/widgets/work-item-graph/utils/graphLayoutWarm.ts')
  return { graphView, createGraphLayoutRunner, warm }
}

/** A prefetch, and the warm-up its dynamic import starts. */
async function prefetch(graphView: Awaited<ReturnType<typeof load>>['graphView']) {
  graphView.prefetch()
  await vi.dynamicImportSettled()
}

const graph = { id: 'root' }

describe('the warm layout worker', () => {
  beforeEach(() => {
    engines.length = 0
    vi.resetModules()
  })
  afterEach(() => vi.useRealTimers())

  it('is started by the prefetch, and the first layout runs on it', async () => {
    const { graphView, createGraphLayoutRunner } = await load()
    await prefetch(graphView)
    // Created before any layout was asked for, and given the warm-up graph.
    expect(engines).toHaveLength(1)
    expect(engines[0].layouts).toHaveLength(1)
    const runner = createGraphLayoutRunner()
    void runner.layout(graph).catch(() => {})
    expect(engines).toHaveLength(1)
    expect(engines[0].layouts).toHaveLength(2)
    runner.dispose()
  })

  it('is not started twice while the spare waits', async () => {
    const { graphView } = await load()
    await prefetch(graphView)
    await prefetch(graphView)
    expect(engines).toHaveLength(1)
  })

  it('is not started while a field holds its own, and is again once that field is gone', async () => {
    const { graphView, createGraphLayoutRunner } = await load()
    const runner = createGraphLayoutRunner()
    void runner.layout(graph).catch(() => {})
    expect(engines).toHaveLength(1)
    await prefetch(graphView)
    expect(engines).toHaveLength(1)
    runner.dispose()
    await prefetch(graphView)
    expect(engines).toHaveLength(2)
  })

  it('goes with the runner that took it, on stop and on dispose, as before', async () => {
    const { graphView, createGraphLayoutRunner } = await load()
    await prefetch(graphView)
    const runner = createGraphLayoutRunner()
    void runner.layout(graph).catch(() => {})
    runner.stop()
    expect(engines[0].terminateWorker).toHaveBeenCalledOnce()
    void runner.layout(graph).catch(() => {})
    expect(engines).toHaveLength(2)
    runner.dispose()
    expect(engines[1].terminateWorker).toHaveBeenCalledOnce()
  })

  it('is ended when nobody takes it within a minute, and the next field starts afresh', async () => {
    vi.useFakeTimers()
    const { graphView, warm } = await load()
    await prefetch(graphView)
    await vi.advanceTimersByTimeAsync(warm.SPARE_LIFETIME_MS - 1)
    expect(engines[0].terminateWorker).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(engines[0].terminateWorker).toHaveBeenCalledOnce()
    warm.takeGraphLayoutEngine()
    expect(engines).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('is ended when its warm-up fails, and the next field starts afresh', async () => {
    const { graphView, warm } = await load()
    await prefetch(graphView)
    engines[0].layouts[0].reject(new Error('worker failed'))
    await vi.waitFor(() => expect(engines[0].terminateWorker).toHaveBeenCalledOnce())
    warm.takeGraphLayoutEngine()
    expect(engines).toHaveLength(2)
  })
})

describe('the warm-up graph', () => {
  it('lays out in ELK itself, with the options of the real layout', async () => {
    const { warmGraph } = await import('@/widgets/work-item-graph/utils/graphLayoutWarm.ts')
    const result = await new ELK().layout(warmGraph())
    expect(result.children?.[0].children?.[0].children).toHaveLength(3)
    expect(result.children?.[0].edges?.[0].sections?.length).toBeGreaterThan(0)
  })
})
