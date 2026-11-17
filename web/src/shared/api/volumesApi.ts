/**
 * How much work stands in a scope and what came to a close in a period: `GET
 * /api/planning/volumes`; and what each goal or stage named took: `GET
 * /api/planning/goal-volumes`.
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
import {
  CONTAINER_STATES,
  SPACE_KEY,
  STATE_CATEGORIES,
  STATE_KEY,
  TITLE,
  WORK_ITEM_REFERENCE,
} from '@/shared/api/planningModel.ts'
import { tokensSchema } from '@/shared/api/planningUsageApi.ts'
import { enumField, invalid, ISO, PROJECT_ID, UUID } from '@/shared/api/platformApiGuards.ts'
import { validatePlanningSpaceRef } from '@/shared/api/platformPlanningRefs.ts'

/** A moment with its own offset, as the period is written: `2026-11-10T00:00:00+03:00`. */
const MOMENT = /^\d{4}-\d{2}-\d{2}T[^\s]{1,80}$/u

const count = () => positiveInt(true)
const reference = () => boundedText(WORK_ITEM_REFERENCE, 20)
const title = () => boundedText(TITLE, 200)

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
  reference: reference(),
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
  goals: count(),
  stages: count(),
  oldest: oldestSchema.nullable(),
})

/**
 * What the items of a goal or stage spent over all its time: agent time, the sum of the
 * stretches, tokens by kind and their cost at API prices. `partly_measured` counts its tasks
 * begun before usage was first counted to an item, which spent more than this says.
 */
const spentSchema = strictObject({
  agent_seconds: z.number().nonnegative(),
  tokens: tokensSchema,
  estimated_api_cost_usd: z.number().nonnegative().nullable(),
  unpriced_tokens: count(),
  quality: enumField(['observed', 'estimated', 'mixed'] as const).nullable(),
  partly_measured: count(),
})

const goalRowShape = {
  work_item_id: boundedText(UUID, 36),
  reference: reference(),
  title: title(),
  kind: enumField(['goal', 'stage'] as const),
  /** Null for an accepted open goal or stage, which derives `container_state` instead. */
  state: strictObject({
    key: boundedText(STATE_KEY, 32),
    name: title(),
    category: enumField(STATE_CATEGORIES),
    is_terminal: z.boolean(),
  }).nullable(),
  container_state: enumField(CONTAINER_STATES).nullable(),
  open: z.boolean(),
  parent_reference: reference().nullable(),
  /** The space of a goal from another space than the one read; null for its own. */
  other_space: strictObject({ key: boundedText(SPACE_KEY, 8), name: title() }).nullable(),
  /** Some of its items are outside the scope, which adds up only the rest. */
  partial: z.boolean(),
  /** Without the items standing cancelled now; their children count by their own state. */
  spent: spentSchema,
  spent_with_cancelled: spentSchema,
}

/** A row stands in a state or derives one, never both. */
const standing = (row: { container_state: unknown; state: unknown }) =>
  (row.state === null) !== (row.container_state === null)
const STANDING = { message: 'expected a state or a container state' }

const goalRowSchema = strictObject(goalRowShape).refine(standing, STANDING)

type VolumesGoalRow = z.infer<typeof goalRowSchema>
/** A row of the volumes read, with the rows of the stages under it that its scope holds. */
type VolumesGoalTree = VolumesGoalRow & { children: VolumesGoalTree[] }

const goalTreeSchema: z.ZodType<VolumesGoalTree> = z.lazy(() =>
  strictObject({ ...goalRowShape, children: z.array(goalTreeSchema) }).refine(standing, STANDING),
)

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
  /** The open goals and those that came to a close in the period. */
  goals: z.array(goalTreeSchema),
})

const interfaceVersion = z.literal('valkama-planning-api', {
  message: 'expected valkama-planning-api',
})

const answer = strictObject({ interface_version: interfaceVersion, volumes: volumesSchema })

/** A volumes answer, or a refusal naming what does not fit the contract. */
export function validateVolumesAnswer(payload: unknown) {
  return parseContract(answer, payload, 'planning.volumes', invalid).volumes
}

const goalVolumesAnswer = strictObject({
  interface_version: interfaceVersion,
  /** One row for each goal or stage asked for, in the order asked, read whole. */
  goals: z.array(goalRowSchema).min(1).max(100),
})

/** A goal-volumes answer, or a refusal naming what does not fit the contract. */
export function validateGoalVolumesAnswer(payload: unknown) {
  return parseContract(goalVolumesAnswer, payload, 'planning.goal-volumes', invalid).goals
}
