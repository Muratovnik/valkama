/**
 * The URL is the state, and this is the only thing that writes it.
 *
 * Every navigation goes through `writeRoute`, which clears the two failure flags
 * before it moves — a route that resolved is proof the last one's failure is over.
 * Back, forward and any navigation the shell did not start land in `applyLocation`.
 *
 * A clean entry — "/" with no query, which is how both the desktop shell and a
 * bookmark arrive — is not a failure. It waits for the context read model to say
 * where the operator was, which `usePlatformEntryRestore` then writes.
 */

import { computed, ref, watch } from 'vue'

import { router } from '@/app/router.ts'

import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import {
  isPlatformRouteUnavailable,
  resolvePlatformRoute,
  serializePlatformRoute,
} from '@/shared/api/platformRoute.ts'
import type {
  OperatingScope,
  PlatformRoute,
  PlatformRouteUnavailable,
} from '@/shared/api/platformRoute.ts'

export const DEFAULT_ROUTE: PlatformRoute = { module_id: 'planning', scope: { kind: 'global' } }
const CLEAN_ENTRY_PATHS = new Set(['/', '/index.html'])

/**
 * "/" with no query, which is how both the desktop shell and a bookmark arrive.
 *
 * Not a failure: the shell waits for the context read model to say where the
 * operator was rather than reporting a URL it can parse perfectly well.
 */
function isCleanEntry(): boolean {
  const current = router.currentRoute.value
  return CLEAN_ENTRY_PATHS.has(current.path) && !current.fullPath.includes('?')
}

export function usePlatformNavigation(invalidRouteMessage: () => string) {
  const route = ref<PlatformRoute>(DEFAULT_ROUTE)
  const routeUnavailable = ref<PlatformRouteUnavailable | null>(null)
  const routeFailure = ref('')
  const entryRestorePending = ref(false)

  function currentLocation(): PlatformRoute | PlatformRouteUnavailable {
    return resolvePlatformRoute(new URL(router.currentRoute.value.fullPath, location.origin))
  }

  function applyLocation() {
    routeFailure.value = ''
    if (isCleanEntry()) {
      // Desktop and browser entries land on "/": restore the last server-side
      // route once the context read model arrives instead of failing the URL.
      entryRestorePending.value = true
      routeUnavailable.value = null
      route.value = DEFAULT_ROUTE
      return
    }
    entryRestorePending.value = false
    try {
      const resolved = currentLocation()
      if (isPlatformRouteUnavailable(resolved)) {
        routeUnavailable.value = resolved
        route.value = { module_id: 'planning', scope: resolved.input_scope }
      } else {
        routeUnavailable.value = null
        route.value = resolved
      }
    } catch {
      routeUnavailable.value = null
      routeFailure.value = invalidRouteMessage()
      route.value = DEFAULT_ROUTE
    }
  }

  applyLocation()

  const activeModule = computed(() => route.value.module_id)
  const operatingScope = computed(() => route.value.scope)
  const routeBlocked = computed(() => Boolean(routeFailure.value || routeUnavailable.value))

  function writeRoute(next: PlatformRoute, mode: 'push' | 'replace' = 'push') {
    routeFailure.value = ''
    routeUnavailable.value = null
    route.value = next
    const href = serializePlatformRoute(next)
    void (mode === 'push' ? router.push(href) : router.replace(href))
  }

  function switchModule(moduleId: ModuleId) {
    writeRoute({ module_id: moduleId, scope: operatingScope.value })
  }

  function switchScope(value: string) {
    const scope: OperatingScope =
      value === 'global'
        ? { kind: 'global' }
        : { kind: 'project', project_ref: { project_id: value.replace(/^project:/u, '') } }
    writeRoute({ module_id: activeModule.value, scope })
  }

  function goHome() {
    writeRoute(DEFAULT_ROUTE)
  }

  function openProject(projectId: string, moduleId: ModuleId = 'planning') {
    writeRoute({
      module_id: moduleId,
      scope: { kind: 'project', project_ref: { project_id: projectId } },
    })
  }

  function updateModuleState(state: Record<string, string | number | boolean>) {
    writeRoute({ ...route.value, state: Object.keys(state).length ? state : undefined }, 'replace')
  }

  function updateSkillRoute(
    skill: { key: string; scope: 'global' | 'project'; project_id?: string } | null,
  ) {
    writeRoute(
      {
        module_id: 'skills',
        scope: operatingScope.value,
        entity:
          skill === null
            ? undefined
            : {
                kind: 'skill',
                skill_key: skill.key,
                source_scope: skill.scope,
                ...(skill.project_id ? { project_id: skill.project_id } : {}),
              },
        state: route.value.state,
      },
      'replace',
    )
  }

  // Back, forward and any navigation the shell did not initiate land here.
  watch(() => router.currentRoute.value.fullPath, applyLocation)

  return {
    activeModule,
    entryRestorePending,
    goHome,
    openProject,
    operatingScope,
    route,
    routeBlocked,
    routeFailure,
    routeUnavailable,
    switchModule,
    switchScope,
    updateModuleState,
    updateSkillRoute,
    writeRoute,
  }
}
