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

import { computed, ref, shallowRef, watch } from 'vue'
import { isNavigationFailure, NavigationFailureType } from 'vue-router'

import { router } from '@/app/router.ts'

import { lookAcrossScopes } from '@/pages/planning/composables/usePlanningChainScope.ts'

import { documentPageAddress } from '@/shared/api/documentPage.ts'
import type { DocumentPageAddress } from '@/shared/api/documentPage.ts'
import type { ModuleId } from '@/shared/api/platformModuleContract.ts'
import {
  isPlatformRouteUnavailable,
  recoverWorkRoute,
  resolvePlatformRoute,
  serializePlatformRoute,
  withoutQuestionReveal,
  withoutQuestionsAsk,
  workItemLinkText,
} from '@/shared/api/platformRoute.ts'
import type {
  OperatingScope,
  PlatformRoute,
  PlatformRouteResolution,
  PlatformRouteUnavailable,
} from '@/shared/api/platformRoute.ts'
import { secureFetch } from '@/shared/api/secureFetch.ts'

export const DEFAULT_ROUTE: PlatformRoute = { module_id: 'planning', scope: { kind: 'global' } }
const CLEAN_ENTRY_PATHS = new Set(['/', '/index.html'])
/**
 * What a module keeps of its route state when the scope changes. The module knows which of
 * its keys those are; the shell knows only whom to ask.
 */
const STATE_ACROSS_SCOPES = new Map<ModuleId, typeof lookAcrossScopes>([
  ['planning', lookAcrossScopes],
])

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

/** What identifies the item a route opens, as a value two routes can be compared by. */
const entityKey = (route: PlatformRoute) => JSON.stringify(route.entity ?? null)

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
  /** The text of a work item address the server did not redirect, or null on any other. */
  const workItemLink = ref<string | null>(null)
  /** The document a `/doc` address names, or null on any other: the page is then only that. */
  const documentPage = shallowRef<DocumentPageAddress | null>(null)
  const entryRestorePending = ref(false)
  const pendingSession = ref('')
  /** How many times an address has asked for the panel of questions, which the shell holds. */
  const questionsAsked = ref(0)
  /**
   * The card an address asked to be taken to the waiting question of, until that card has
   * taken the order. It is one order and not a place to be in: a move refused, or any other
   * card opened first, ends it, so an ordinary opening later on scrolls nowhere. The route
   * may stand on this card already, and then only this moves, as nothing in the address does.
   */
  const askedCard = ref<string | null>(null)
  const cardQuestionAsked = computed(
    () => askedCard.value !== null && askedCard.value === entityKey(route.value),
  )
  function cardQuestionTaken() {
    askedCard.value = null
  }
  function askForQuestion(next: PlatformRouteResolution) {
    if (isPlatformRouteUnavailable(next) || next.entity?.kind !== 'work-item') return
    askedCard.value = entityKey(next)
  }
  watch(
    () => entityKey(route.value),
    (now) => {
      if (askedCard.value !== now) askedCard.value = null
    },
  )

  function applyLocation() {
    // The window's address and not the router's: the first read comes before the router has
    // read it, and the shell would stand here for a moment, with everything it starts.
    documentPage.value = documentPageAddress(new URL(location.href))
    if (documentPage.value === null) {
      applyShellLocation()
      return
    }
    routeFailure.value = ''
    workItemLink.value = null
    entryRestorePending.value = false
    routeUnavailable.value = null
    route.value = DEFAULT_ROUTE
  }

  /** An order is taken out of the address. That moves it, and the move comes back without it. */
  function obeyAddressOrder() {
    const address = new URL(router.currentRoute.value.fullPath, location.origin)
    const rest = withoutQuestionsAsk(address)
    const card = withoutQuestionReveal(address)
    if (rest !== null) questionsAsked.value += 1
    else if (card !== null) {
      try {
        askForQuestion(resolvePlatformRoute(new URL(card, location.origin)))
      } catch {
        // The shell reads what is left once it is back, and says what it finds.
      }
    }
    const left = rest ?? card
    if (left !== null) void router.replace(left)
    return left !== null
  }

  function applyShellLocation() {
    if (obeyAddressOrder()) return
    routeFailure.value = ''
    workItemLink.value = workItemLinkText(router.currentRoute.value.path)
    if (workItemLink.value !== null) {
      entryRestorePending.value = false
      routeUnavailable.value = null
      route.value = DEFAULT_ROUTE
      return
    }
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
  const routeBlocked = computed(
    () =>
      documentPage.value !== null ||
      workItemLink.value !== null ||
      Boolean(routeFailure.value || routeUnavailable.value),
  )

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
    ) {
      if (askedCard.value === entityKey(next)) askedCard.value = null
      return
    }
    routeFailure.value = ''
    routeUnavailable.value = null
    workItemLink.value = null
    documentPage.value = null
    route.value = next
  }

  function writeRoute(next: PlatformRoute, mode: 'push' | 'replace' = 'push') {
    void navigate(next, mode)
  }

  function switchModule(moduleId: ModuleId) {
    writeRoute({ module_id: moduleId, scope: operatingScope.value })
  }

  /**
   * A module's place in another scope, with what the module says goes along when the
   * operator is already in it. It starts fresh otherwise: the state is the module's own.
   */
  function inScope(moduleId: ModuleId, scope: OperatingScope): PlatformRoute {
    const carried =
      route.value.module_id === moduleId
        ? STATE_ACROSS_SCOPES.get(moduleId)?.(route.value.state)
        : undefined
    return carried && Object.keys(carried).length
      ? { module_id: moduleId, scope, state: carried }
      : { module_id: moduleId, scope }
  }

  function switchScope(value: string) {
    const scope: OperatingScope =
      value === 'global'
        ? { kind: 'global' }
        : { kind: 'project', project_ref: { project_id: value.replace(/^project:/u, '') } }
    writeRoute(inScope(activeModule.value, scope))
  }

  function goHome() {
    writeRoute(inScope(DEFAULT_ROUTE.module_id, DEFAULT_ROUTE.scope))
  }

  function openProject(projectId: string, moduleId: ModuleId = 'planning') {
    writeRoute(inScope(moduleId, { kind: 'project', project_ref: { project_id: projectId } }))
  }

  /**
   * A module's new state, in place by default; `push` makes it a new place in the history, for
   * a change Back should return from.
   */
  function updateModuleState(
    state: Record<string, string | number | boolean>,
    mode: 'push' | 'replace' = 'replace',
  ) {
    writeRoute({ ...route.value, state: Object.keys(state).length ? state : undefined }, mode)
  }

  /** Moves to a route asked for from outside, with the order it carries. False if it cannot. */
  function moveToAddress(address: URL) {
    const card = withoutQuestionReveal(address)
    const resolved = resolvePlatformRoute(card === null ? address : new URL(card, address.origin))
    if (isPlatformRouteUnavailable(resolved)) return false
    if (card !== null) askForQuestion(resolved)
    writeRoute(resolved)
    return true
  }

  /**
   * A toast knows an item's number and not its route, which only the server can work
   * out. Its redirect says where the card is. An address it does not redirect is left
   * to the shell, which reads it and says what is wrong, as it does on any other load.
   */
  async function followWorkItemAddress(address: URL) {
    try {
      const response = await secureFetch(address)
      if (response.ok && response.redirected && moveToAddress(new URL(response.url))) return
    } catch {
      // The shell asks again below, and says what it finds.
    }
    void router.push(`${address.pathname}${address.search}`)
  }

  /**
   * A card the desktop app was asked for from outside while this page is up. It is
   * a navigation like any other here, so the leave check asks before a draft goes
   * and the page never reloads. The panel of questions opens over whatever is on
   * screen and moves nothing. The app checks the route's shape first; one this page
   * cannot read leaves it where it is. A document's own window holds no card and does not
   * listen: its saying so would tell the app that the main window's page is ready.
   */
  ;(documentPage.value === null ? window.valkamaDesktop : undefined)?.onOpenRoute?.((href) => {
    try {
      const address = new URL(href, location.origin)
      if (withoutQuestionsAsk(address) !== null) {
        questionsAsked.value += 1
        return
      }
      if (workItemLinkText(address.pathname) !== null) {
        void followWorkItemAddress(address)
        return
      }
      moveToAddress(address)
    } catch {
      // Nothing to show for an address nobody here asked for.
    }
  })

  // Back, forward and any navigation the shell did not initiate land here.
  watch(() => router.currentRoute.value.fullPath, applyLocation)

  return {
    activeModule,
    cardQuestionAsked,
    cardQuestionTaken,
    documentPage,
    entryRestorePending,
    goHome,
    openProject,
    operatingScope,
    pendingSession,
    questionsAsked,
    route,
    routeBlocked,
    routeFailure,
    routeUnavailable,
    switchModule,
    switchScope,
    updateModuleState,
    workItemLink,
    writeRoute,
  }
}
