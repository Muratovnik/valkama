import { watch } from 'vue'
import type { Ref } from 'vue'

import { useDebounceFn } from '@vueuse/core'

import { savePlatformUiPrefs } from '@/shared/api/platformApi.ts'
import type { PlatformContextReady, PlatformUiPrefs } from '@/shared/api/platformApiTypes.ts'
import type { ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { resolveManifestRouteAuthority } from '@/shared/api/platformRoute.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'

interface EntryInputs {
  blocked: Ref<boolean>
  contextReady: Ref<PlatformContextReady | null>
  contextState: Ref<PlatformUiState<PlatformContextReady>>
  defaultRoute: PlatformRoute
  entryRestorePending: Ref<boolean>
  modules: Ref<readonly ModuleManifest[]>
  modulesSettled: Ref<boolean>
  route: Ref<PlatformRoute>
  writeRoute: (next: PlatformRoute, mode?: 'push' | 'replace') => void
}

/**
 * Where the app lands on a clean entry, and what it remembers for next time.
 *
 * Desktop and browser both open "/", so the last route is restored from the
 * server-side preference once the context read model arrives — but only if it
 * still resolves: a project that lost its binding, or a resource that is no longer
 * mapped, falls back rather than restoring a dead destination.
 */
/**
 * The remembered route, or null when it no longer resolves.
 *
 * Null is a real answer here, not an error: a project that lost its binding and
 * a resource that is no longer mapped are both ordinary, and the caller has a
 * fallback for them. Restoring either would open a destination that is gone.
 */
export function resolvedPreferredRoute(
  context: PlatformContextReady,
  prefs: PlatformUiPrefs,
  modules: readonly ModuleManifest[],
): PlatformRoute | null {
  const manifest = modules.find((module) => module.module_id === prefs.module_id)
  if (!manifest) return null
  const scope = prefs.scope
  const base: PlatformRoute = { module_id: manifest.module_id, scope }
  if (resolveManifestRouteAuthority(manifest, base).status === 'unavailable') return null
  if (scope.kind === 'global') {
    if (!prefs.resource_ref) return base
    const preferred = { ...base, entity: prefs.resource_ref }
    return resolveManifestRouteAuthority(manifest, preferred).status === 'ready' ? preferred : base
  }
  const project = context.projects.find((item) => item.project_id === scope.project_ref.project_id)
  if (project?.binding_state !== 'mapped') return null
  if (prefs.resource_ref === undefined) return base
  const encodedResource = JSON.stringify(prefs.resource_ref)
  const stillMapped = project.resources.some(
    (resource) =>
      resource.state === 'mapped' && JSON.stringify(resource.resource_ref) === encodedResource,
  )
  if (!stillMapped) return base
  const preferred = { ...base, entity: prefs.resource_ref }
  return resolveManifestRouteAuthority(manifest, preferred).status === 'ready' ? preferred : base
}

export function usePlatformEntryRestore(inputs: EntryInputs) {
  function restoredEntryRoute(): PlatformRoute {
    const context = inputs.contextReady.value
    const prefs = context?.ui_prefs
    const preferred =
      context && prefs ? resolvedPreferredRoute(context, prefs, inputs.modules.value) : null
    if (preferred) return preferred
    // Nothing remembered, or it is gone. One mapped project is an unambiguous
    // destination on its own; anything else lands on the shell default.
    const mapped = (context?.projects ?? []).filter((project) => project.binding_state === 'mapped')
    if (mapped.length === 1) {
      return {
        module_id: 'planning',
        scope: { kind: 'project', project_ref: { project_id: mapped[0].project_id } },
      }
    }
    return inputs.defaultRoute
  }

  watch([inputs.contextState, inputs.modulesSettled], () => {
    if (
      !inputs.entryRestorePending.value ||
      inputs.contextState.value.status === 'loading' ||
      !inputs.modulesSettled.value
    )
      return
    inputs.entryRestorePending.value = false
    inputs.writeRoute(restoredEntryRoute(), 'replace')
  })

  let lastSavedPrefs = ''
  const savePrefsSoon = useDebounceFn((prefs: PlatformUiPrefs, encoded: string) => {
    lastSavedPrefs = encoded
    void savePlatformUiPrefs(prefs).catch(() => {})
  }, 400)

  watch(
    () =>
      [
        inputs.route.value.module_id,
        JSON.stringify(inputs.route.value.scope),
        JSON.stringify(inputs.route.value.entity),
      ] as const,
    () => {
      if (inputs.entryRestorePending.value || inputs.blocked.value) return
      const prefs: PlatformUiPrefs = {
        module_id: inputs.route.value.module_id,
        scope: inputs.route.value.scope,
        ...(inputs.route.value.entity ? { resource_ref: inputs.route.value.entity } : {}),
      }
      const encoded = JSON.stringify(prefs)
      if (encoded === lastSavedPrefs) return
      void savePrefsSoon(prefs, encoded)
    },
  )

  return { restoredEntryRoute }
}
