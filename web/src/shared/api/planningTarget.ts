import { boundedText, fromValidator, strictObject, z } from '@/shared/api/contract.ts'
import { PROJECT_ID } from '@/shared/api/platformApiGuards.ts'
import {
  planningWorkItemEntity,
  validatePlanningSpaceRef,
} from '@/shared/api/platformPlanningRefs.ts'

const spaceRefSchema = fromValidator(validatePlanningSpaceRef)

export const planningTargetSchema = strictObject({
  project_id: boundedText(PROJECT_ID, 160),
  space_ref: spaceRefSchema,
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
  project_id: boundedText(PROJECT_ID, 160),
  space_ref: spaceRefSchema,
  status: z.enum(['searched', 'unavailable']),
  reason: z.string().min(1).max(240).nullable(),
})

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

export function serializePlanningTarget(target: PlanningTarget) {
  const validated = planningTargetSchema.parse(target)
  return {
    project_id: validated.project_id,
    data_scope_id: validated.space_ref.data_scope_id,
    space_key: validated.space_ref.space_key,
  }
}
