import { fromValidator, strictObject, z } from '@/shared/api/contract.ts'
import {
  planningWorkItemEntity,
  validatePlanningSpaceRef,
} from '@/shared/api/platformPlanningRefs.ts'
import type { PlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

/** A space as a route names it: the store it lies in and its key. */
export const planningSpaceRefSchema = fromValidator(validatePlanningSpaceRef)

export const planningTargetSchema = strictObject({
  space_ref: planningSpaceRefSchema,
  reference: z.string().min(1).max(18),
  writable: z.boolean(),
}).superRefine((target, context) => {
  try {
    planningWorkItemEntity({ space_ref: target.space_ref, reference: target.reference })
  } catch {
    context.addIssue({
      code: 'custom',
      path: ['reference'],
      message: 'Invalid work item reference',
    })
  }
})

export type PlanningTarget = z.infer<typeof planningTargetSchema>

export const planningCoverageSchema = strictObject({
  space_ref: planningSpaceRefSchema,
  status: z.enum(['searched', 'unavailable']),
  reason: z.string().min(1).max(240).nullable(),
})

/** One source a read across spaces names: read, or not read with why. */
export type PlanningCoverage = z.infer<typeof planningCoverageSchema>

/** Whether a read left a source out: what it shows is then incomplete. */
export function coverageIncomplete(coverage: readonly PlanningCoverage[]): boolean {
  return coverage.some((source) => source.status === 'unavailable')
}

/**
 * Why a source was skipped, by the stable code the server names it with
 * (`PlanningRouting.unavailable_reason`, plus what each listing adds for a store
 * that opened and then failed). A code outside this list reads as `other`, so a
 * raw reason never reaches the screen.
 */
const SKIPPED_SOURCE_REASONS = new Set([
  'store_not_attached',
  'store_unreadable',
  'attached_list_unreadable',
  'space_missing',
  'binding_conflict',
  'search_failed',
  'requests_unavailable',
])

export function skippedSourceReason(reason: string | null): string {
  return reason !== null && SKIPPED_SOURCE_REASONS.has(reason) ? reason : 'other'
}

/** The route of one card: its space, as the server's card route spells it. */
export function planningTargetRoute(target: PlanningTarget): PlatformRoute {
  return {
    module_id: 'planning',
    scope: { kind: 'space', space_ref: target.space_ref },
    entity: planningWorkItemEntity({ space_ref: target.space_ref, reference: target.reference }),
  }
}

/** The route of one space: its work, every project of it. */
export function planningSpaceRoute(spaceRef: PlanningSpaceRef): PlatformRoute {
  return { module_id: 'planning', scope: { kind: 'space', space_ref: spaceRef } }
}

export function serializePlanningTarget(target: PlanningTarget) {
  const validated = planningTargetSchema.parse(target)
  return {
    data_scope_id: validated.space_ref.data_scope_id,
    space_key: validated.space_ref.space_key,
  }
}
