import { defineComponent, h, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePlanningPortfolio } from '@/pages/planning/composables/usePlanningPortfolio.ts'

import GraphLayoutStatus from '@/widgets/work-item-graph/components/GraphLayoutStatus.vue'
import { useWorkItemExecutions } from '@/widgets/work-item-inspector/utils/useWorkItemExecutions.ts'

import { fetchExecutionHistory } from '@/shared/api/executionApi.ts'
import { validateHistory } from '@/shared/api/executionModel.ts'
import { fetchPlatformPlanning } from '@/shared/api/platformPlanningApi.ts'
import type { PlatformPlanningPayload } from '@/shared/api/platformPlanningTypes.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import { uiReady } from '@/shared/api/platformUiState.ts'
import { messages } from '@/shared/i18n/index.ts'
import { LOADING_DELAY_MS } from '@/shared/ui/loadingPresence.ts'

import { executionHistory } from '../browser/executionFixtures.ts'

vi.mock('@/shared/api/executionApi.ts', () => ({
  fetchExecutionCapabilities: vi.fn(),
  fetchExecutionHistory: vi.fn(),
  launchWorkItem: vi.fn(),
  stopLaunch: vi.fn(),
}))
vi.mock('@/shared/api/platformPlanningApi.ts', () => ({ fetchPlatformPlanning: vi.fn() }))

const i18n = createI18n({ legacy: false, locale: 'en', fallbackLocale: 'en', messages })

/** A promise the test settles, so a read can be held open while the view is looked at. */
function deferred<T>() {
  let settle!: (value: T) => void
  let refuse!: (reason: unknown) => void
  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve
    refuse = reject
  })
  return { promise, refuse, settle }
}

const blank = () => h('div')

/** Mount a composable inside a component, which its lifecycle hooks need. */
function host<T>(setup: () => T): T {
  let result: T | undefined
  mount(
    defineComponent({
      setup() {
        result = setup()
        return blank
      },
    }),
    { global: { plugins: [i18n] } },
  )
  if (result === undefined) throw new Error('the composable did not run')
  return result
}

/**
 * Work in the background takes no room while something is drawn. Each case
 * below put a line into the flow, or replaced a drawn region with "Loading…",
 * on a refresh of something already on screen.
 */
describe('background work leaves what is drawn in place', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('says nothing about a layout over a drawing until it has run for 600ms', async () => {
    const status = mount(GraphLayoutStatus, {
      props: { drawn: true, failed: false, pending: true },
      global: { plugins: [i18n] },
    })
    await vi.advanceTimersByTimeAsync(599)
    expect(status.find('[role="status"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(status.get('[role="status"]').text()).toBe(messages.en.graph.layoutLoading)
    await status.setProps({ pending: false })
    expect(status.find('[role="status"]').exists()).toBe(false)
  })

  it('says a first layout is running after the delay every first load takes', async () => {
    const status = mount(GraphLayoutStatus, {
      props: { drawn: false, failed: false, pending: true },
      global: { plugins: [i18n] },
    })
    await vi.advanceTimersByTimeAsync(LOADING_DELAY_MS - 1)
    expect(status.find('[role="status"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(status.find('[role="status"]').exists()).toBe(true)
  })

  it('says at once that a layout failed, with a way to try again', async () => {
    const status = mount(GraphLayoutStatus, {
      props: { drawn: true, failed: true, pending: false },
      global: { plugins: [i18n] },
    })
    expect(status.get('[role="alert"]').text()).toContain(messages.en.graph.layoutFailed)
    await status.get('button').trigger('click')
    expect(status.emitted('retry')).toHaveLength(1)
  })

  it('keeps an item’s attempts on screen while they are read again, and after a failed re-read', async () => {
    const history = validateHistory(executionHistory)
    const first = deferred<typeof history>()
    vi.mocked(fetchExecutionHistory).mockReturnValueOnce(first.promise)
    const token = ref(0)
    const reads = host(() =>
      useWorkItemExecutions(
        () => 'MAIN-12',
        ref(false),
        async () => {},
        () => `item:${token.value}`,
      ),
    )
    // The first read of an item is a load: there is nothing of it to keep.
    expect(reads.loading.value).toBe(true)
    first.settle(history)
    await flushPromises()
    expect(reads.loading.value).toBe(false)
    expect(reads.executions.value).toHaveLength(history.executions.length)

    const again = deferred<typeof history>()
    vi.mocked(fetchExecutionHistory).mockReturnValueOnce(again.promise)
    token.value += 1
    await nextTick()
    expect(reads.loading.value).toBe(false)
    expect(reads.executions.value).toHaveLength(history.executions.length)
    again.refuse(new Error('the execution module did not answer'))
    await flushPromises()
    expect(reads.executions.value).toHaveLength(history.executions.length)
    expect(reads.error.value).toBe('')
  })

  it('keeps the project directory drawn while it is refreshed and says when the refresh failed', async () => {
    const scope = ref<OperatingScope>({ kind: 'global' })
    const directory: PlatformPlanningPayload = {
      interface_version: 'valkama-planning',
      scope: scope.value,
      state: uiReady({ planning_spaces: [], projects: [] }),
    }
    vi.mocked(fetchPlatformPlanning).mockResolvedValueOnce(directory)
    const portfolio = host(() => usePlanningPortfolio(() => scope.value))
    void portfolio.load()
    expect(portfolio.state.value.status).toBe('loading')
    await flushPromises()
    expect(portfolio.state.value.status).toBe('ready')

    const again = deferred<PlatformPlanningPayload>()
    vi.mocked(fetchPlatformPlanning).mockReturnValueOnce(again.promise)
    void portfolio.load()
    // The same scope read again is a refresh: its payload stays, marked stale.
    expect(portfolio.state.value).toMatchObject({ status: 'degraded', payload: { projects: [] } })
    expect('reason' in portfolio.state.value).toBe(false)
    again.refuse(new Error('offline'))
    await flushPromises()
    expect(portfolio.state.value).toMatchObject({ status: 'degraded', payload: { projects: [] } })
    expect('reason' in portfolio.state.value).toBe(true)

    // Another scope is a new directory, which starts from loading.
    vi.mocked(fetchPlatformPlanning).mockReturnValueOnce(new Promise(() => {}))
    scope.value = { kind: 'project', project_ref: { project_id: 'example-project' } }
    void portfolio.load()
    expect(portfolio.state.value.status).toBe('loading')
  })
})
