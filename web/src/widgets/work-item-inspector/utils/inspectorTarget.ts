import type { PlanningTarget } from '@/shared/api/planningTarget.ts'
import { planningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceEntityRef } from '@/shared/types/reference.ts'

/**
 * The exact address of the item a card shows, for the parts of the card that
 * act on it by address; none while its space cannot be read from the card.
 */
export function inspectorTarget(card: {
  reference: string
  resourceRef: PlanningSpaceEntityRef
  writable: boolean
}): PlanningTarget | undefined {
  const space = planningSpaceRef(card.resourceRef)
  return space
    ? {
        space_ref: space,
        reference: card.reference,
        writable: card.writable,
      }
    : undefined
}
