import { computed } from 'vue'

import {
  planningSpaceEntity,
  resolvePlanningRouteSelection,
} from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

interface RouteInputs {
  route: () => PlatformRoute
  scope: () => OperatingScope
}

/**
 * Which space, project and item the route names.
 *
 * The scope names the space and, when it narrows, the project; the route names the
 * item inside the space. Which item is open is in the route rather than in the
 * surface, which is what makes an item linkable: a reload comes back to it, Back
 * closes it, and a bookmark is a work item rather than a space. It reads the item out
 * of the same `work-item` entity the Kernel encodes — `{space_ref, reference}` — so
 * there is one spelling of the identity.
 */
export function usePlanningRouteSelection(inputs: RouteInputs) {
  const selection = computed(() => {
    const scope = inputs.scope()
    return resolvePlanningRouteSelection(
      inputs.route().entity,
      scope.kind === 'space' ? scope.space_ref : undefined,
    )
  })

  /** The space the work is read from, which is what write ownership keys on. */
  const space = computed<PlanningSpaceRef | undefined>(() =>
    selection.value.status === 'ready' ? selection.value.space_ref : undefined,
  )

  /** The canonical Kernel identity of that space. */
  const spaceResourceRef = computed<PlanningSpaceEntityRef | undefined>(() => {
    const bound = space.value
    return bound === undefined ? undefined : planningSpaceEntity(bound)
  })

  const projectId = computed(() => {
    const scope = inputs.scope()
    return scope.kind === 'space' ? scope.project_ref?.project_id : undefined
  })

  /** Which item the route names. */
  const open = computed(() =>
    selection.value.status === 'ready' ? (selection.value.work_item_ref?.reference ?? null) : null,
  )

  /**
   * A reference is unique only inside its planning space. Key the inspector by
   * the complete route identity so an equally named item in an attached store
   * cannot inherit the first item's selected panel, draft, error, or result.
   */
  const openIdentity = computed(() => {
    const bound = space.value
    const reference = open.value
    return bound === undefined || reference === null
      ? ''
      : `${projectId.value}:${bound.data_scope_id}:${bound.space_key}:${reference}`
  })

  return { open, openIdentity, projectId, selection, space, spaceResourceRef }
}
