import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { fetchPlatformContext, fetchPlatformRegistry } from '@/shared/api/platformApi.ts'
import type { PlatformContextReady, PlatformRegistryReady } from '@/shared/api/platformApiTypes.ts'
import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import {
  beginResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import { resourceUiState } from '@/shared/api/resourceUiState.ts'
import type { Observed } from '@/shared/api/resourceUiState.ts'
import { typedFailure } from '@/shared/api/typedFailure.ts'

interface RouteView {
  blocked: Ref<boolean>
  module: Ref<ModuleId>
  route: Ref<PlatformRoute>
}

interface ReadModel<T> {
  state: ComputedRef<PlatformUiState<T>>
  load: (key: string, answer: () => Promise<PlatformUiState<T>>) => Promise<void>
  settle: (key: string, answer: PlatformUiState<T>) => void
}

/**
 * A keyed read model that commits only the newest request.
 *
 * The generation bookkeeping lives in `resourceState`, so a scope switch during
 * a slow response cannot overwrite the newer one that finished first — the
 * resource rejects a commit whose generation is no longer current.
 */
function useReadModel<T>(now: () => string): ReadModel<T> {
  const resource = ref(createResource<Observed<T>>()) as Ref<ResourceState<Observed<T>>>
  const state = computed(() => resourceUiState(resource.value))

  /** Commit an answer the shell already knows, without asking the server. */
  function settle(key: string, answer: PlatformUiState<T>) {
    resource.value = beginResource(resource.value, key)
    const generation = resource.value.generation
    resource.value = resolveResource(resource.value, generation, key, { state: answer, at: now() })
  }

  async function load(key: string, answer: () => Promise<PlatformUiState<T>>) {
    resource.value = beginResource(resource.value, key)
    const generation = resource.value.generation
    try {
      const next = await answer()
      resource.value = resolveResource(resource.value, generation, key, {
        state: next,
        at: now(),
      })
    } catch (error) {
      resource.value = rejectResource(resource.value, generation, key, typedFailure(error))
    }
  }

  return { state, load, settle }
}

function scopeKey(route: PlatformRoute): string {
  return JSON.stringify(route.scope)
}

/**
 * The three shell read models and their loaders.
 */
export function usePlatformReadModels(
  route: RouteView,
  now: () => string = () => new Date().toISOString(),
) {
  const context = useReadModel<PlatformContextReady>(now)
  const registry = useReadModel<PlatformRegistryReady>(now)

  async function loadContext() {
    // The context is global, so its key never changes: every load after the
    // first is a plain refresh of the same thing.
    await context.load('global', async () => {
      const payload = await fetchPlatformContext({ kind: 'global' })
      return payload.state
    })
  }

  async function loadRegistry() {
    await registry.load(scopeKey(route.route.value), async () => {
      const payload = await fetchPlatformRegistry(route.route.value.scope)
      return payload.state
    })
  }

  async function syncRouteResources() {
    if (route.blocked.value) return
    if (route.module.value === 'settings' || route.route.value.entity?.kind === 'work-item')
      await loadRegistry()
  }

  return {
    contextState: context.state,
    registryState: registry.state,
    loadContext,
    loadRegistry,
    syncRouteResources,
  }
}
