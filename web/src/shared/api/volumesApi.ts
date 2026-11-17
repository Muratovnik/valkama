/**
 * How much work stands in a scope and what came to a close in a period: `GET
 * /api/planning/volumes`.
 *
 * The scope is every space, one space, or one space narrowed to a project, and holds the
 * items that space's board holds, so a number here opens the board on the same work. The
 * read names its scope exactly and answers for the store the service writes, the one
 * read under `/api/planning/` that takes a data scope. Strict like every planning
 * contract: a field nobody declared is refused rather than drawn.
 */

import {
  boundedText,
  fromValidator,
  parseContract,
  positiveInt,
  strictObject,
  z,
} from '@/shared/api/contract.ts'
import { STATE_CATEGORIES, WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { enumField, invalid, ISO, PROJECT_ID, UUID } from '@/shared/api/platformApiGuards.ts'
import { validatePlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'

/** A moment with its own offset, as the period is written: `2026-11-10T00:00:00+03:00`. */
const MOMENT = /^\d{4}-\d{2}-\d{2}T[^\s]{1,80}$/u

const count = () => positiveInt(true)

const scopeSchema = z.union([
  strictObject({ kind: z.literal('global'), space_ref: z.null(), project_ref: z.null() }),
  strictObject({
    kind: z.literal('space'),
    space_ref: fromValidator(validatePlanningSpaceRef),
    project_ref: strictObject({ project_id: boundedText(PROJECT_ID, 160) }).nullable(),
  }),
])

/** The card that came to stand in its category first, and when: its last state entry. */
const oldestSchema = strictObject({
  work_item_id: boundedText(UUID, 36),
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  since: boundedText(ISO, 96),
})

/**
 * One category: its tasks and its goals and stages. An open category counts what stands in
 * it now and names its oldest card; completed and cancelled count what came to stand there
 * inside the period, and name none.
 */
const categorySchema = strictObject({
  category: enumField(STATE_CATEGORIES),
  tasks: count(),
  containers: count(),
  oldest: oldestSchema.nullable(),
})

const volumesSchema = strictObject({
  scope: scopeSchema,
  period: strictObject({
    from: boundedText(MOMENT, 96),
    to: boundedText(MOMENT, 96),
    utc_offset: z.number().int().min(-840).max(840),
  }),
  /** When usage was first counted to an item in this store; null before any was. */
  measured_from: boundedText(ISO, 96).nullable(),
  counts: strictObject({
    /** The eight categories, always all, in the model's order. */
    categories: z.array(categorySchema).length(STATE_CATEGORIES.length),
  }),
})

const answer = strictObject({
  interface_version: z.literal('valkama-planning-api', {
    message: 'expected valkama-planning-api',
  }),
  volumes: volumesSchema,
})

/** A volumes answer, or a refusal naming what does not fit the contract. */
export function validateVolumesAnswer(payload: unknown) {
  return parseContract(answer, payload, 'planning.volumes', invalid).volumes
}
