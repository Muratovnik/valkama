import { computed, ref } from 'vue'
import type { Ref } from 'vue'

import { fetchModules } from '@/shared/api/platformApi.ts'
import type { ModuleManifest, ModuleRegistration } from '@/shared/api/platformModuleContract.ts'
import {
  beginResource,
  createResource,
  rejectResource,
  resolveResource,
} from '@/shared/api/resourceState.ts'
import type { ResourceState } from '@/shared/api/resourceState.ts'
import { typedFailure } from '@/shared/api/typedFailure.ts'
import type { TypedFailure } from '@/shared/api/typedFailure.ts'
export type ConnectionState = 'connecting' | 'live' | 'reconnecting'
interface LiveFeedInputs {
  moduleAuthorityReady: Ref<boolean>
  notice: Ref<string>
  text: { failure: (failure: TypedFailure) => string; refreshed: () => string }
  loadContext: () => Promise<void>
  syncRouteResources: () => Promise<void>
}
export function usePlatformLiveFeed(inputs: LiveFeedInputs) {
  const moduleResource = ref(createResource<readonly ModuleRegistration[]>()) as Ref<
    ResourceState<readonly ModuleRegistration[]>
  >
  const moduleRegistrations = computed(() => moduleResource.value.data ?? [])
  const modules = computed<readonly ModuleManifest[]>(() =>
    moduleRegistrations.value
      .filter(
        (r) => r.state === 'enabled' && ['planning', 'settings'].includes(r.manifest.module_id),
      )
      .map((r) => r.manifest),
  )
  const modulesAuthoritative = computed(() => moduleResource.value.data !== null)
  const modulesSettled = computed(() => !['idle', 'loading'].includes(moduleResource.value.status))
  const modulesFailure = computed<TypedFailure | null>(() => moduleResource.value.failure)
  const connectionState = ref<ConnectionState>('connecting')
  const refreshing = ref(false)
  async function loadModules() {
    moduleResource.value = beginResource(moduleResource.value, 'modules')
    const generation = moduleResource.value.generation
    try {
      const payload = await fetchModules()
      moduleResource.value = resolveResource(
        moduleResource.value,
        generation,
        'modules',
        payload.modules,
      )
    } catch (error) {
      const failure = typedFailure(error, 'request_failed')
      moduleResource.value = rejectResource(moduleResource.value, generation, 'modules', failure)
      throw failure
    } finally {
      inputs.moduleAuthorityReady.value = modulesAuthoritative.value
    }
  }
  async function refreshAll() {
    if (refreshing.value) return
    refreshing.value = true
    try {
      await Promise.all([loadModules(), inputs.loadContext(), inputs.syncRouteResources()])
      connectionState.value = 'live'
      inputs.notice.value = inputs.text.refreshed()
    } catch (error) {
      connectionState.value = 'reconnecting'
      inputs.notice.value = inputs.text.failure(typedFailure(error, 'request_failed'))
    } finally {
      refreshing.value = false
    }
  }
  void Promise.all([loadModules(), inputs.loadContext()])
    .then(async () => {
      await inputs.syncRouteResources()
      connectionState.value = 'live'
    })
    .catch(() => {
      connectionState.value = 'reconnecting'
    })
  return {
    modules,
    moduleRegistrations,
    modulesAuthoritative,
    modulesSettled,
    modulesFailure,
    connectionState,
    refreshing,
    loadModules,
    refreshAll,
  }
}
