/** Route one session-linked item through its exact canonical Planning binding. */

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import type { ModuleRegistration } from '@/shared/api/platformModuleContract.ts'
import { planningSpaceRef, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { resolveManifestRouteAuthority } from '@/shared/api/platformRoute.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

/**
 * Resolve no aliases: the resource id must be canonical, mapped, and owned by
 * exactly one project. A matching space key in another store is irrelevant.
 */
export function resolveSessionWorkItemRoute(
  resourceRef: PlanningSpaceEntityRef,
  reference: string,
  context: PlatformContextReady | null,
  registrations: readonly ModuleRegistration[],
): PlatformRoute | null {
  let space: PlanningSpaceRef | undefined
  let entity: EntityRef
  try {
    space = planningSpaceRef(resourceRef)
    if (!space) return null
    entity = planningWorkItemEntity({ space_ref: space, reference })
  } catch {
    return null
  }

  const candidates = (context?.projects ?? [])
    .filter((project) => project.binding_state === 'mapped')
    .filter((project) =>
      project.resources.some(
        (resource) =>
          resource.state === 'mapped' &&
          resource.resource_ref.kind === resourceRef.kind &&
          'resource_id' in resource.resource_ref &&
          resource.resource_ref.resource_id === resourceRef.resource_id,
      ),
    )
  if (candidates.length !== 1) return null

  const next: PlatformRoute = {
    module_id: 'planning',
    scope: {
      kind: 'project',
      project_ref: { project_id: candidates[0].project_id },
    },
    entity,
  }
  const registration = registrations.find(
    (candidate) => candidate.manifest.module_id === 'planning' && candidate.state === 'enabled',
  )
  if (
    !registration ||
    resolveManifestRouteAuthority(registration.manifest, next).status === 'unavailable'
  ) {
    return null
  }
  return next
}
