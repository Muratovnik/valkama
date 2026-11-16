import { computed } from 'vue'
import type { Ref } from 'vue'

import { lookAcrossScopes } from '@/pages/planning/composables/usePlanningChainScope.ts'

import { planningSpaceRoute, planningTargetRoute } from '@/shared/api/planningTarget.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

/** What of the live-work frame is on show: a space's board, or a card in it. */
export interface LiveShown {
  key: string
  /** The card on show, or null on the space's board. */
  reference: string | null
}

/** The place a row of the side panel names: a space and, for a row, its item. */
export interface LivePlace {
  key: string
  reference: string | null
}

/** The space the page stands in, by its scope, and the card its address opens there. */
function shownOn(route: PlatformRoute): (LiveShown & { scopeId: string }) | null {
  if (route.module_id !== 'planning' || route.scope.kind !== 'space') return null
  const { data_scope_id: scopeId, space_key: key } = route.scope.space_ref
  try {
    const item = planningWorkItemRef(route.entity)
    return { scopeId, key, reference: item?.reference ?? null }
  } catch {
    return { scopeId, key, reference: null }
  }
}

/**
 * Where a row of the side panel leads, and which row is the page on show.
 *
 * The frame is the primary store's, so a row names its space by key and the store
 * is the primary one. A row opens its card the way a card opens on the board: in its
 * own space the work is still looked at as it was, the whole state kept; in another
 * space what the module carries across scopes goes along, so the view does not
 * change under the reader. A row opens the whole space, not one project of it.
 */
export function useLiveWorkNav(
  route: Ref<PlatformRoute>,
  context: Ref<PlatformContextReady | null>,
) {
  const primaryScopeId = () => context.value?.primary.data_scope_id ?? null
  const shown = computed(() => shownOn(route.value))

  const current = computed<LiveShown | null>(() => {
    const on = shown.value
    return on && on.scopeId === primaryScopeId() ? { key: on.key, reference: on.reference } : null
  })

  function target(place: LivePlace): PlatformRoute | null {
    const scopeId = primaryScopeId()
    if (scopeId === null) return null
    const space_ref = { data_scope_id: scopeId, space_key: place.key }
    const next =
      place.reference === null
        ? planningSpaceRoute(space_ref)
        : planningTargetRoute({ space_ref, reference: place.reference, writable: true })
    if (route.value.module_id !== 'planning') return next
    const inSpace = shown.value?.scopeId === scopeId && shown.value.key === place.key
    const state = inSpace ? route.value.state : lookAcrossScopes(route.value.state)
    return state && Object.keys(state).length > 0 ? { ...next, state } : next
  }

  return { current, target }
}
