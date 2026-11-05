import { computed } from 'vue'
import type { Ref } from 'vue'

import { lookAcrossScopes } from '@/pages/planning/composables/usePlanningChainScope.ts'

import { planningSpaceRoute, planningTargetRoute } from '@/shared/api/planningTarget.ts'
import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import { planningSpaceRef, planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
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
  project_id: string | null
  reference: string | null
}

function shownOn(route: PlatformRoute): (LiveShown & { scopeId: string }) | null {
  if (route.module_id !== 'planning') return null
  try {
    const item = planningWorkItemRef(route.entity)
    if (item)
      return {
        scopeId: item.space_ref.data_scope_id,
        key: item.space_ref.space_key,
        reference: item.reference,
      }
    const space = planningSpaceRef(route.entity)
    return space ? { scopeId: space.data_scope_id, key: space.space_key, reference: null } : null
  } catch {
    return null
  }
}

/**
 * Where a row of the side panel leads, and which row is the page on show.
 *
 * The frame is the primary store's, so a row names its space by key and the store
 * is the primary one. A row opens its card the way a card opens on the board: in its
 * own space the work is still looked at as it was, the whole state kept; in another
 * space what the module carries across scopes goes along, so the view does not
 * change under the reader. A space no project binds has nowhere to open.
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
    if (scopeId === null || place.project_id === null) return null
    const space_ref = { data_scope_id: scopeId, space_key: place.key }
    const next =
      place.reference === null
        ? planningSpaceRoute(place.project_id, space_ref)
        : planningTargetRoute({
            project_id: place.project_id,
            space_ref,
            reference: place.reference,
            writable: true,
          })
    if (route.value.module_id !== 'planning') return next
    const sameSpace = shown.value?.scopeId === scopeId && shown.value.key === place.key
    const state = sameSpace ? route.value.state : lookAcrossScopes(route.value.state)
    return state && Object.keys(state).length > 0 ? { ...next, state } : next
  }

  return { current, target }
}
