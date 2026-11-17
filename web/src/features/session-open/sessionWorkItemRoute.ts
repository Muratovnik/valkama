/** Route one session-linked item to its card, in the space that holds it. */

import type { PlatformContextReady } from '@/shared/api/platformApiTypes.ts'
import type { EntityRef } from '@/shared/api/platformEntityRef.ts'
import type { ModuleRegistration } from '@/shared/api/platformModuleContract.ts'
import {
  planningSpaceRef,
  planningWorkItemEntity,
  sameSpace,
} from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'
import { resolveManifestRouteAuthority } from '@/shared/api/platformRoute.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

/**
 * Resolve no aliases: the resource id must be canonical and name a space this
 * workstation lists. A matching space key in another store is irrelevant.
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

  const held = space
  if (!(context?.spaces ?? []).some((item) => sameSpace(item, held))) return null

  const next: PlatformRoute = {
    module_id: 'planning',
    scope: { kind: 'space', space_ref: held },
    entity,
  }
  const registration = registrations.find(
    (candidate) => candidate.manifest.module_id === 'planning',
  )
  return !registration ||
    resolveManifestRouteAuthority(registration.manifest, next).status === 'unavailable'
    ? null
    : next
}
