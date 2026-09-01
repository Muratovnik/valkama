import { computed } from 'vue'
import type { Ref } from 'vue'

import type { ProjectDirectoryResource } from '@/shared/api/platformApiTypes.ts'
import { hasModuleRenderer } from '@/shared/api/platformModuleContract.ts'
import type { ModuleManifest, ModuleRegistration } from '@/shared/api/platformModuleContract.ts'
import type { PlatformRoute, PlatformRouteUnavailable } from '@/shared/api/platformRoute.ts'
import {
  resolveManifestRouteAuthority,
  validateManifestRouteState,
} from '@/shared/api/platformRoute.ts'

interface AuthorityInputs {
  modules: Ref<readonly ModuleManifest[]>
  modulesAuthoritative: Ref<boolean>
  modulesSettled: Ref<boolean>
  parsedUnavailable: Ref<PlatformRouteUnavailable | null>
  registrations: Ref<readonly ModuleRegistration[]>
  route: Ref<PlatformRoute>
  loadModules: () => Promise<void>
  loadRegistry: () => Promise<void>
  te: (key: string) => boolean
  translate: (key: string) => string
}

/**
 * Project resources the active module can truthfully accept as secondary
 * context. Mapping state and both manifest declarations participate: a broad
 * supported-kind declaration alone does not authorize a scoped route.
 */
export function selectableProjectResources(
  manifest: ModuleManifest | undefined,
  resources: readonly ProjectDirectoryResource[],
): ProjectDirectoryResource[] {
  if (manifest === undefined) return []
  const secondary = manifest.secondary_context.project
  if (secondary.behavior !== 'all') return []
  const supported = new Set(manifest.supported_entity_kinds)
  const scoped = new Set(secondary.kinds)
  return resources.filter(
    (resource) =>
      resource.state === 'mapped' &&
      supported.has(resource.resource_ref.kind) &&
      scoped.has(resource.resource_ref.kind),
  )
}

/** Recheck a resource emission against the manifest current at click time. */
export function resolveResourceSelection(
  manifest: ModuleManifest | undefined,
  route: PlatformRoute,
  resource: ProjectDirectoryResource,
): PlatformRoute | null {
  if (
    manifest === undefined ||
    manifest.module_id !== route.module_id ||
    route.scope.kind !== 'project' ||
    resource.state !== 'mapped'
  )
    return null
  const proposed = { ...route, entity: resource.resource_ref }
  return resolveManifestRouteAuthority(manifest, proposed).status === 'ready' ? proposed : null
}

export function useModuleRouteAuthority(inputs: AuthorityInputs) {
  const activeRegistration = computed(() =>
    inputs.registrations.value.find(
      (item) => item.manifest.module_id === inputs.route.value.module_id,
    ),
  )
  const activeManifest = computed(() =>
    activeRegistration.value?.state === 'enabled' &&
    hasModuleRenderer(activeRegistration.value.manifest.module_id)
      ? activeRegistration.value.manifest
      : undefined,
  )
  const moduleTitle = computed(() => {
    const manifest = activeRegistration.value?.manifest
    if (manifest === undefined) return inputs.route.value.module_id
    return inputs.te(manifest.title_key) ? inputs.translate(manifest.title_key) : manifest.module_id
  })
  const routeUnavailable = computed<PlatformRouteUnavailable | null>(() => {
    if (!inputs.modulesSettled.value || !inputs.modulesAuthoritative.value) return null
    const available = inputs.modules.value.map((module) => module.module_id)
    if (inputs.parsedUnavailable.value)
      return {
        ...inputs.parsedUnavailable.value,
        recovery: { kind: 'choose-module', available_modules: available },
      }
    const registration = activeRegistration.value
    if (registration?.state === 'enabled' && hasModuleRenderer(registration.manifest.module_id)) {
      const authority = resolveManifestRouteAuthority(registration.manifest, inputs.route.value)
      if (authority.status === 'ready') return null
      return {
        status: 'unavailable',
        reason: authority.reason,
        input_module_id: inputs.route.value.module_id,
        input_scope: inputs.route.value.scope,
        recovery: { kind: 'choose-module', available_modules: available },
      }
    }
    let reason: PlatformRouteUnavailable['reason'] = 'unsupported-view'
    if (registration === undefined) reason = 'unknown-module'
    else if (registration.state === 'disabled') reason = 'disabled-module'
    return {
      status: 'unavailable',
      reason,
      input_module_id: inputs.route.value.module_id,
      input_scope: inputs.route.value.scope,
      recovery: { kind: 'choose-module', available_modules: available },
    }
  })
  const routeFailure = computed(() => {
    if (!inputs.modulesAuthoritative.value || activeManifest.value === undefined) return ''
    try {
      if (inputs.route.value.state !== undefined)
        validateManifestRouteState(activeManifest.value, inputs.route.value.state, 'route.state')
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  })
  async function reloadModuleState() {
    await Promise.all([inputs.loadModules(), inputs.loadRegistry()])
  }
  return { activeManifest, moduleTitle, reloadModuleState, routeFailure, routeUnavailable }
}
