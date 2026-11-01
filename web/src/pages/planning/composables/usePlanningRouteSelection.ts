import { computed } from 'vue'

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import {
  planningSpaceEntity,
  resolvePlanningRouteSelection,
} from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { OperatingScope, PlatformRoute } from '@/shared/api/platformRoute.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

interface RouteInputs {
  context: () => PlatformContextReady | null
  route: () => PlatformRoute
  scope: () => OperatingScope
}

/**
 * Which project, space and item the route names, as the Kernel binds them.
 *
 * The Kernel answers which project this is and which resource it is bound to;
 * the route names the item inside it. Which item is open is in the route rather
 * than in the surface, which is what makes an item linkable: a reload comes back
 * to it, Back closes it, and a bookmark is a work item rather than a space. It
 * reads the item out of the same `work-item` entity the Kernel encodes —
 * `{space_ref, reference}` — so there is one spelling of the identity.
 */
export function usePlanningRouteSelection(inputs: RouteInputs) {
  const mappedResourceRefs = computed<EntityRef[]>(() => {
    const scope = inputs.scope()
    if (scope.kind !== 'project') return []
    const project = inputs
      .context()
      ?.projects.find((item) => item.project_id === scope.project_ref.project_id)
    return (project?.resources ?? [])
      .filter((resource) => resource.state === 'mapped')
      .map((resource) => resource.resource_ref)
  })

  const selection = computed(() =>
    resolvePlanningRouteSelection(
      inputs.route().entity,
      mappedResourceRefs.value,
      inputs.scope().kind === 'project',
    ),
  )

  /** The Kernel resource this project binds, which is what write ownership keys on. */
  const space = computed<PlanningSpaceRef | undefined>(() =>
    selection.value.status === 'ready' ? selection.value.space_ref : undefined,
  )

  /** The canonical Kernel identity whose project binding owns local source access. */
  const spaceResourceRef = computed<PlanningSpaceEntityRef | undefined>(() => {
    const bound = space.value
    return bound === undefined ? undefined : planningSpaceEntity(bound)
  })

  const projectId = computed(() => {
    const scope = inputs.scope()
    return scope.kind === 'project' ? scope.project_ref.project_id : undefined
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
