import { computed } from 'vue'
import type { Ref } from 'vue'

import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { hasModuleRenderer } from '@/shared/api/platformModuleContract.ts'
import type { ModuleManifest, ModuleRegistration } from '@/shared/api/platformModuleContract.ts'
import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
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
  te: (key: string) => boolean
  translate: (key: string) => string
}

/**
 * Where a task pressed in the module on show opens its card: over that module, when its manifest
 * admits a work item in the route, as the same route naming the card; null where it does not, and
 * on the board, which opens the card in the task's own space instead.
 */
export function cardInPlace(
  manifest: ModuleManifest | undefined,
  route: PlatformRoute,
  target: PlanningTarget,
): PlatformRoute | null {
  if (manifest === undefined || manifest.module_id !== route.module_id) return null
  if (route.module_id === 'planning') return null
  const proposed: PlatformRoute = {
    ...route,
    entity: planningWorkItemEntity({ space_ref: target.space_ref, reference: target.reference }),
  }
  return resolveManifestRouteAuthority(manifest, proposed).status === 'ready' ? proposed : null
}

export function useModuleRouteAuthority(inputs: AuthorityInputs) {
  const activeRegistration = computed(() =>
    inputs.registrations.value.find(
      (item) => item.manifest.module_id === inputs.route.value.module_id,
    ),
  )
  const activeManifest = computed(() =>
    activeRegistration.value !== undefined &&
    hasModuleRenderer(activeRegistration.value.manifest.module_id)
      ? activeRegistration.value.manifest
      : undefined,
  )
  // No title until the module list has named this module: the address's id stood in the
  // context bar for the moment before it, then turned into the title.
  const moduleTitle = computed(() => {
    const manifest = activeRegistration.value?.manifest
    if (manifest === undefined) return ''
    return inputs.te(manifest.title_key) ? inputs.translate(manifest.title_key) : manifest.module_id
  })
  const routeUnavailable = computed<PlatformRouteUnavailable | null>(() => {
    if (!inputs.modulesSettled.value || !inputs.modulesAuthoritative.value) return null
    const available = inputs.modules.value.map((module) => module.module_id)
    const parsed = inputs.parsedUnavailable.value
    // A retired address keeps its own way out, the choice of a space; any other the modules.
    if (parsed)
      return parsed.recovery.kind === 'choose-space'
        ? parsed
        : { ...parsed, recovery: { kind: 'choose-module', available_modules: available } }
    const registration = activeRegistration.value
    if (registration !== undefined && hasModuleRenderer(registration.manifest.module_id)) {
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
    return {
      status: 'unavailable',
      reason: registration === undefined ? 'unknown-module' : 'unsupported-view',
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
  return { activeManifest, moduleTitle, routeFailure, routeUnavailable }
}
