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

export function serializePlanningTarget(target: PlanningTarget) {
  const validated = planningTargetSchema.parse(target)
  return {
    project_id: validated.project_id,
    data_scope_id: validated.space_ref.data_scope_id,
    space_key: validated.space_ref.space_key,
  }
}
