import { computed } from 'vue'

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import {
  planningSpaceEntity,
  resolvePlanningRouteSelection,
  sameSpace,
} from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

interface RouteInputs {
  /** The spaces this workstation lists, with their projects; null before they are read. */
  context?: () => PlatformContextReady | null
  route: () => PlatformRoute
  scope: () => OperatingScope
}

/**
 * Which space, project and item the route names, and the project the workspace stands on.
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

  /** The space the scope names as this workstation lists it; undefined at the top or when absent. */
  const listedSpace = computed(() => {
    const bound = space.value
    return bound && inputs.context?.()?.spaces.find((item) => sameSpace(item, bound))
  })

  /**
   * The project the workspace stands on: the one the scope narrows to, else the space's
   * default one. The card's Memory searches it and a new work item starts on it. A space with
   * no project has none, and an empty string is what the card and the new-work dialog render
   * as that, where `undefined` would be a missing prop.
   */
  const workspaceProject = computed(
    () => projectId.value ?? listedSpace.value?.default_project ?? '',
  )

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

  return {
    listedSpace,
    open,
    openIdentity,
    projectId,
    selection,
    space,
    spaceResourceRef,
    workspaceProject,
  }
}
