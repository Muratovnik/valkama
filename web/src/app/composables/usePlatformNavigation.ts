/**
 * The URL is the state, and this is the only thing that writes it.
 *
 * Every navigation goes through `writeRoute`, which clears the two failure flags
 * once it has moved — a route that resolved is proof the last one's failure is over.
 * Back, forward and any navigation the shell did not start land in `applyLocation`.
 *
 * A clean entry — "/" with no query, which is how both the desktop shell and a
 * bookmark arrive — is not a failure. It waits for the context read model to say
 * where the operator was, which `usePlatformEntryRestore` then writes.
 */

import { computed, ref, watch } from 'vue'
import { isNavigationFailure, NavigationFailureType } from 'vue-router'

import { router } from '@/app/router.ts'

import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import {
  isPlatformRouteUnavailable,
  recoverWorkRoute,
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

/** What a readable address lost on the way in: its module state, or its whole query. */
export type DroppedRoutePart = 'query' | 'state'

/**
 * Read the address, giving up the least that makes it readable.
 *
 * A path names a module and a scope; the query only says how that module is
 * looked at. A query that does not read — a hand-edited `state`, a link cut
 * short — used to block the whole module behind «invalid URL». Now the state
 * is dropped first, then the whole query, and the module opens; only a path
 * that names nothing fails.
 */
function readLocation(url: URL): {
  dropped: DroppedRoutePart | null
  resolved: PlatformRoute | PlatformRouteUnavailable
} {
  try {
    return { dropped: null, resolved: resolvePlatformRoute(url) }
  } catch (error) {
    const attempts: [DroppedRoutePart, URL][] = []
    if (url.searchParams.has('state')) {
      const withoutState = new URL(url)
      withoutState.searchParams.delete('state')
      attempts.push(['state', withoutState])
    }
    if (url.search || url.hash) attempts.push(['query', new URL(url.pathname, url.origin)])
    for (const [dropped, attempt] of attempts) {
      try {
        return { dropped, resolved: resolvePlatformRoute(attempt) }
      } catch {
        // The next attempt gives up more of the address.
      }
    }
    throw error
  }
}

export function usePlatformNavigation(
  notFoundMessage: () => string,
  dropped: (part: DroppedRoutePart) => void = () => {},
) {
  const route = ref<PlatformRoute>(DEFAULT_ROUTE)
  const routeUnavailable = ref<PlatformRouteUnavailable | null>(null)
  const routeFailure = ref('')
  const entryRestorePending = ref(false)
  const pendingSession = ref('')

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
      const { dropped: lost, resolved } = readLocation(
        new URL(router.currentRoute.value.fullPath, location.origin),
      )
      if (lost !== null) {
        dropped(lost)
        if (!isPlatformRouteUnavailable(resolved))
          void router.replace(serializePlatformRoute(recoverWorkRoute(resolved)))
      }
      if (isPlatformRouteUnavailable(resolved)) {
        routeUnavailable.value = resolved
        route.value = { module_id: 'planning', scope: resolved.input_scope }
      } else {
        routeUnavailable.value = null
        const recovered = recoverWorkRoute(resolved)
        if (recovered === resolved) {
          route.value = resolved
        } else {
          pendingSession.value =
            resolved.entity?.kind === 'session' ? resolved.entity.session_id : ''
          route.value = recovered
          void router.replace(serializePlatformRoute(route.value))
        }
      }
    } catch {
      routeUnavailable.value = null
      routeFailure.value = notFoundMessage()
      route.value = DEFAULT_ROUTE
    }
  }

  applyLocation()

  const activeModule = computed(() => route.value.module_id)
  const operatingScope = computed(() => route.value.scope)
  const routeBlocked = computed(() => Boolean(routeFailure.value || routeUnavailable.value))

  /**
   * The route moves once the router has agreed to move. Writing it first
   * unmounted an open item before the leave guard could ask about its draft;
   * a move the guard refused, or a newer one overtook, leaves it as it was.
   */
  async function navigate(next: PlatformRoute, mode: 'push' | 'replace') {
    const href = serializePlatformRoute(next)
    const failure = await (mode === 'push' ? router.push(href) : router.replace(href))
    if (
      isNavigationFailure(failure, NavigationFailureType.aborted) ||
      isNavigationFailure(failure, NavigationFailureType.cancelled)
    )
      return
    routeFailure.value = ''
    routeUnavailable.value = null
    route.value = next
  }

  function writeRoute(next: PlatformRoute, mode: 'push' | 'replace' = 'push') {
    void navigate(next, mode)
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

  // Back, forward and any navigation the shell did not initiate land here.
  watch(() => router.currentRoute.value.fullPath, applyLocation)

  return {
    activeModule,
    entryRestorePending,
    goHome,
    openProject,
    operatingScope,
    pendingSession,
    route,
    routeBlocked,
    routeFailure,
    routeUnavailable,
    switchModule,
    switchScope,
    updateModuleState,
    writeRoute,
  }
}
