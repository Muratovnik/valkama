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

/**
 * The number of the running test. Vitest does not stop the body of a test that
 * timed out, so such a body can resume during a later test and act on the modules
 * that test loaded; `whileCurrent` parks it instead.
 */
const running = vi.hoisted(() => ({ test: 0 }))

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

// The view's download is not what is measured here, and mocking its loader keeps
// each test's fresh import to the warm-up and the runner instead of Vue and the shell.
vi.mock('@/shared/ui/lazyView.ts', () => ({
  lazyView: () => ({ prefetch: () => {} }),
}))

/** Resolves while `test` is still the running one; for a body that outlived its test, never. */
function whileCurrent(test: number): Promise<void> {
  return test === running.test ? Promise.resolve() : new Promise<void>(() => {})
}

async function load() {
  const test = running.test
  const { graphView } = await import('@/pages/planning/utils/graphView.ts')
  const { createGraphLayoutRunner } =
    await import('@/widgets/work-item-graph/utils/graphLayoutRunner.ts')
  const { SPARE_LIFETIME_MS, takeGraphLayoutEngine } =
    await import('@/widgets/work-item-graph/utils/graphLayoutWarm.ts')
  await whileCurrent(test)
  return {
    createGraphLayoutRunner,
    SPARE_LIFETIME_MS,
    takeGraphLayoutEngine,
    /** A prefetch, and the warm-up its dynamic import starts. */
    prefetch: async () => {
      graphView.prefetch()
      await vi.dynamicImportSettled()
      await whileCurrent(test)
    },
    /** For an await the test makes itself, before it acts on the modules. */
    whileCurrent: () => whileCurrent(test),
  }
}

const graph = { id: 'root' }

describe('the warm layout worker', () => {
  beforeEach(() => {
    running.test += 1
    engines.length = 0
    vi.resetModules()
  })
  afterEach(() => vi.useRealTimers())

  it('is started by the prefetch, and the first layout runs on it', async () => {
    const { prefetch, createGraphLayoutRunner } = await load()
    await prefetch()
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
    const { prefetch } = await load()
    await prefetch()
    await prefetch()
    expect(engines).toHaveLength(1)
  })

  it('is not started while a field holds its own, and is again once that field is gone', async () => {
    const { prefetch, createGraphLayoutRunner } = await load()
    const runner = createGraphLayoutRunner()
    void runner.layout(graph).catch(() => {})
    expect(engines).toHaveLength(1)
    await prefetch()
    expect(engines).toHaveLength(1)
    runner.dispose()
    await prefetch()
    expect(engines).toHaveLength(2)
  })

  it('goes with the runner that took it, on stop and on dispose, as before', async () => {
    const { prefetch, createGraphLayoutRunner } = await load()
    await prefetch()
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
    const { prefetch, SPARE_LIFETIME_MS, takeGraphLayoutEngine, whileCurrent } = await load()
    await prefetch()
    await vi.advanceTimersByTimeAsync(SPARE_LIFETIME_MS - 1)
    expect(engines[0].terminateWorker).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(engines[0].terminateWorker).toHaveBeenCalledOnce()
    await whileCurrent()
    takeGraphLayoutEngine()
    expect(engines).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('is ended when its warm-up fails, and the next field starts afresh', async () => {
    const { prefetch, takeGraphLayoutEngine, whileCurrent } = await load()
    await prefetch()
    engines[0].layouts[0].reject(new Error('worker failed'))
    await vi.waitFor(() => expect(engines[0].terminateWorker).toHaveBeenCalledOnce())
    await whileCurrent()
    takeGraphLayoutEngine()
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
