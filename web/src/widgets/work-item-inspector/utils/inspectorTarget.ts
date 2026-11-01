import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { planningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

/**
 * The exact address of the item a card shows, for the parts of the card that
 * act on it by address; none in a global scope, where no project names it.
 */
export function inspectorTarget(card: {
  projectId: string
  reference: string
  resourceRef: PlanningSpaceEntityRef
  writable: boolean
}): PlanningTarget | undefined {
  const space = planningSpaceRef(card.resourceRef)
  return card.projectId && space
    ? {
        project_id: card.projectId,
        space_ref: space,
        reference: card.reference,
        writable: card.writable,
      }
    : undefined
}
