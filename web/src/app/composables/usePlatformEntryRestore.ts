import { watch } from 'vue'
import type { Ref } from 'vue'

import { useDebounceFn } from '@vueuse/core'

import { savePlatformUiPrefs } from '@/shared/api/platformApi.ts'
import type { PlatformContextReady, PlatformUiPrefs } from '@/shared/api/platformApiTypes.ts'
import type { ModuleManifest } from '@/shared/api/platformModuleContract.ts'
import { sameSpace } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
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
  writeRoute: (next: PlatformRoute, mode?: 'push' | 'replace') => Promise<void> | void
}

/**
 * Where the app lands on a clean entry, and what it remembers for next time.
 *
 * Desktop and browser both open "/", so the last route is restored from the
 * server-side preference once the context read model arrives — but only if it
 * still resolves: a space this workstation no longer has falls back rather than
 * restoring a dead destination.
 */
/**
 * The remembered route, or null when it no longer resolves.
 *
 * Null is a real answer here, not an error: a space that went away is ordinary,
 * and the caller has a fallback for it. A project the space no longer lists is
 * dropped and the whole space opens. Restoring either would open a destination
 * that is gone.
 */
/** The remembered scope as it still stands: its space listed, its project still one of it. */
function restoredScope(
  context: PlatformContextReady,
  scope: OperatingScope,
): OperatingScope | null {
  if (scope.kind === 'global') return scope
  const space = context.spaces.find((item) => sameSpace(item, scope.space_ref))
  if (space === undefined) return null
  const project = scope.project_ref?.project_id
  const listed = [...space.projects, ...space.other_space_projects].some(
    (item) => item.project_id === project,
  )
  return project === undefined || listed ? scope : { kind: 'space', space_ref: scope.space_ref }
}

export function resolvedPreferredRoute(
  context: PlatformContextReady,
  prefs: PlatformUiPrefs,
  modules: readonly ModuleManifest[],
): PlatformRoute | null {
  const manifest = modules.find((module) => module.module_id === prefs.module_id)
  if (!manifest) return null
  const scope = prefs.scope
  const restored = restoredScope(context, scope)
  if (restored === null) return null
  const base: PlatformRoute = { module_id: manifest.module_id, scope: restored }
  if (resolveManifestRouteAuthority(manifest, base).status === 'unavailable') return null
  if (!prefs.resource_ref) return base
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
    // Nothing remembered, or it is gone. One space is an unambiguous destination
    // on its own; anything else lands on the shell default.
    const spaces = context?.spaces ?? []
    if (spaces.length === 1) {
      const [{ data_scope_id, space_key }] = spaces
      return {
        module_id: 'planning',
        scope: { kind: 'space', space_ref: { data_scope_id, space_key } },
      }
    }
    return inputs.defaultRoute
  }

  // The entry is pending until the remembered route has been written, not until it was asked
  // for: the router moves a moment later, and in between the chrome named the default route.
  let restoring = false
  watch([inputs.contextState, inputs.modulesSettled], () => {
    if (
      !inputs.entryRestorePending.value ||
      restoring ||
      inputs.contextState.value.status === 'loading' ||
      !inputs.modulesSettled.value
    )
      return
    restoring = true
    void Promise.resolve(inputs.writeRoute(restoredEntryRoute(), 'replace')).finally(() => {
      restoring = false
      inputs.entryRestorePending.value = false
    })
  })

  let lastSavedPrefs = ''
  const savePrefsSoon = useDebounceFn((prefs: PlatformUiPrefs, encoded: string) => {
    lastSavedPrefs = encoded
    void savePlatformUiPrefs(prefs).catch(() => {})
  }, 400)

  watch(
    [
      inputs.modulesSettled,
      inputs.entryRestorePending,
      () => inputs.route.value.module_id,
      () => JSON.stringify(inputs.route.value.scope),
      () => JSON.stringify(inputs.route.value.entity),
    ],
    () => {
      if (inputs.entryRestorePending.value || inputs.blocked.value || !inputs.modulesSettled.value)
        return
      // An address naming a section the shell does not list lost its way; it is
      // not the place to come back to next time.
      const moduleId = inputs.route.value.module_id
      if (!inputs.modules.value.some((module) => module.module_id === moduleId)) return
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
