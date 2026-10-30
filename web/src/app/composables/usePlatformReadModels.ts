import { computed, ref } from 'vue'
import type { ComputedRef, Ref } from 'vue'

import { fetchPlatformContext } from '@/shared/api/platformApi.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
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

interface ReadModel<T> {
  state: ComputedRef<PlatformUiState<T>>
  load: (key: string, answer: () => Promise<PlatformUiState<T>>) => Promise<void>
}

/**
 * A keyed read model that commits only the newest request.
 *
 * The generation bookkeeping lives in `resourceState`, so a slow response
 * cannot overwrite a newer one that finished first — the resource rejects a
 * commit whose generation is no longer current.
 */
function useReadModel<T>(now: () => string): ReadModel<T> {
  const resource = ref(createResource<Observed<T>>()) as Ref<ResourceState<Observed<T>>>
  const state = computed(() => resourceUiState(resource.value))

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

  return { state, load }
}

/**
 * The shell's context read model and its loader.
 */
export function usePlatformReadModels(now: () => string = () => new Date().toISOString()) {
  const context = useReadModel<PlatformContextReady>(now)

  async function loadContext() {
    // The context is global, so its key never changes: every load after the
    // first is a plain refresh of the same thing.
    await context.load('global', async () => {
      const payload = await fetchPlatformContext({ kind: 'global' })
      return payload.state
    })
  }

  return {
    contextState: context.state,
    loadContext,
  }
}
