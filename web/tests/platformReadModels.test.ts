import assert from 'node:assert/strict'

import { nextTick, ref } from 'vue'

import { beforeEach, test, vi } from 'vitest'

import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import type { OperatingScope } from '@/shared/api/platformRoute.ts'
import { uiReady } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'

const fetchPlatformContext = vi.fn()
const fetchPlatformRegistry = vi.fn()

vi.mock('@/shared/api/platformApi.ts', () => ({
  fetchPlatformContext: (...args: unknown[]) => fetchPlatformContext(...args),
  fetchPlatformRegistry: (...args: unknown[]) => fetchPlatformRegistry(...args),
}))

const { usePlatformReadModels } = await import('@/app/composables/usePlatformReadModels.ts')

/** Stands in until the executor runs, which it does before `deferred` returns. */
const unresolved = () => {}

/** A promise a test resolves by hand, so two loads can be interleaved. */
function deferred<T>() {
  let settle: (value: T) => void = unresolved
  const promise = new Promise<T>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

function routeView(scope: OperatingScope) {
  return {
    route: ref({ module_id: 'planning' as ModuleId, scope }),
    module: ref('planning' as ModuleId),
    blocked: ref(false),
  }
}

const GLOBAL: OperatingScope = { kind: 'global' }
function readModels(scope: OperatingScope = GLOBAL) {
  let tick = 0
  const models = usePlatformReadModels(routeView(scope), () => {
    tick += 1
    return `2026-08-15T00:00:0${tick}Z`
  })
  return models
}

beforeEach(() => {
  fetchPlatformContext.mockReset()
  fetchPlatformRegistry.mockReset()
})

test('the first load shows loading, because there is nothing to keep', async () => {
  const answer = deferred<{ state: PlatformUiState<unknown> }>()
  fetchPlatformContext.mockReturnValue(answer.promise)
  const models = readModels()

  const pending = models.loadContext()
  assert.equal(models.contextState.value.status, 'loading')
  answer.settle({ state: uiReady({ projects: [] }) })
  await pending
  assert.equal(models.contextState.value.status, 'ready')
})

test('a refresh keeps the previous payload on screen instead of blanking it', async () => {
  fetchPlatformContext.mockResolvedValueOnce({ state: uiReady({ projects: ['first'] }) })
  const models = readModels()
  await models.loadContext()

  const second = deferred<{ state: PlatformUiState<unknown> }>()
  fetchPlatformContext.mockReturnValue(second.promise)
  const pending = models.loadContext()

  const during = models.contextState.value
  assert.equal(during.status, 'degraded', 'a refresh must not empty the screen')
  assert.deepEqual(during.status === 'degraded' ? during.payload : null, { projects: ['first'] })
  assert.equal(during.status === 'degraded' ? during.stale : false, true)

  second.settle({ state: uiReady({ projects: ['second'] }) })
  await pending
  assert.equal(models.contextState.value.status, 'ready')
})

test('a failed refresh keeps the working registry rather than replacing it with an error', async () => {
  fetchPlatformRegistry.mockResolvedValueOnce({ state: uiReady({ connections: 3 }) })
  const models = readModels()
  await models.loadRegistry()

  fetchPlatformRegistry.mockRejectedValueOnce(new Error('the local service is not answering'))
  await models.loadRegistry()

  const after = models.registryState.value
  assert.equal(after.status, 'degraded')
  assert.deepEqual(after.status === 'degraded' ? after.payload : null, { connections: 3 })
  assert.equal(
    after.status === 'degraded' ? (after.reason ?? '') : '',
    'platform.failures.requestFailed',
  )
})

test('an error with nothing to fall back on is an error', async () => {
  fetchPlatformRegistry.mockRejectedValueOnce(new Error('registry unavailable'))
  const models = readModels()
  await models.loadRegistry()
  assert.equal(models.registryState.value.status, 'error')
})

test('a contract refusal does not expose its raw object path to the screen', async () => {
  const failure = Object.assign(
    new Error('registry.state.payload.audit[0].detail: expected object'),
    {
      code: 'platform_api_contract_invalid',
    },
  )
  fetchPlatformRegistry.mockRejectedValueOnce(failure)
  const models = readModels()
  await models.loadRegistry()
  const state = models.registryState.value
  assert.equal(state.status, 'error')
  assert.equal(state.status === 'error' ? state.reason : '', 'platform.failures.contractInvalid')
})

test('a slow answer for an abandoned request never overwrites the newer one', async () => {
  const slow = deferred<{ state: PlatformUiState<unknown> }>()
  const quick = deferred<{ state: PlatformUiState<unknown> }>()
  fetchPlatformRegistry.mockReturnValueOnce(slow.promise).mockReturnValueOnce(quick.promise)

  const view = routeView(GLOBAL)
  const models = usePlatformReadModels(view, () => '2026-08-15T00:00:00Z')

  const first = models.loadRegistry()
  view.route.value = {
    module_id: 'settings',
    scope: { kind: 'project', project_ref: { project_id: 'new' } },
  }
  const second = models.loadRegistry()

  quick.settle({ state: uiReady({ from: 'new' }) })
  await second
  slow.settle({ state: uiReady({ from: 'old' }) })
  await first
  await nextTick()

  const state = models.registryState.value
  assert.equal(state.status, 'ready')
  assert.deepEqual(state.status === 'ready' ? state.payload : null, { from: 'new' })
})
