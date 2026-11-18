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
import { chainRecentSchema, chainSeriesSchema, DAY } from '@/shared/api/planningChainApi.ts'
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
const label = () => boundedText(/^[^\u{0}]{1,64}$/u, 64)

/** The tasks a filtered read keeps: of any of `kinds` (any kind with none named), with every label. */
const filterSchema = strictObject({
  kinds: z.array(enumField(['task', 'bug', 'improvement'] as const)).max(3),
  labels: z.array(label()),
})

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
 * inside the period, and name none. Under a filter only tasks match, and the goals and stages
 * are null.
 */
const categorySchema = strictObject({
  category: enumField(STATE_CATEGORIES),
  tasks: count(),
  goals: count().nullable(),
  stages: count().nullable(),
  oldest: oldestSchema.nullable(),
})

/** The questions waiting for the owner on the scope's items, and the one asked first. */
const waitingOwnerSchema = strictObject({
  count: count(),
  oldest: strictObject({
    request_id: boundedText(UUID, 36),
    reference: reference(),
    since: boundedText(ISO, 96),
  }).nullable(),
}).refine((waiting) => (waiting.count === 0) === (waiting.oldest === null), {
  message: 'expected the first question exactly when one waits',
})

/** How many tasks of a row stand in each of the eight categories, counted as the counts are. */
const rowCategories = () => z.record(enumField(STATE_CATEGORIES), count())

const PROJECT_VALUE = /^[^\u{0}]{1,512}$/u
const projectName = () => boundedText(PROJECT_VALUE, 512).nullable()

/**
 * A row's project as a project group of the Analytics read is written: its id and name, or
 * null for tasks naming none and for those naming several, which list each set they name.
 */
const projectGroupSchema = strictObject({
  id: boundedText(PROJECT_ID, 160).nullable(),
  unknown: z.literal(false),
  name: projectName(),
  combinations: z
    .array(
      z
        .array(strictObject({ id: boundedText(PROJECT_ID, 160), name: projectName() }))
        .min(2)
        .max(20),
    )
    .nullable(),
})

/**
 * The scope's tasks under no goal. By project each stands in one row, so those rows add up to
 * `tasks`; by label in the row of each of its labels, or of no label, adding up to no total.
 */
const outsideSchema = strictObject({
  tasks: count(),
  by_project: z.array(strictObject({ project: projectGroupSchema, categories: rowCategories() })),
  by_label: z.array(strictObject({ label: label().nullable(), categories: rowCategories() })),
}).refine(
  (outside) =>
    outside.by_project.reduce(
      (sum, row) => sum + Object.values(row.categories).reduce((all, n) => all + n, 0),
      0,
    ) === outside.tasks,
  { message: 'expected the rows by project to add up to the tasks' },
)

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

/**
 * Its tasks (`task`, `bug`, `improvement`) under it now at any depth, in any state: how
 * many, how many are closed and how, and how many stand in each category.
 */
const tasksSchema = strictObject({
  total: count(),
  closed: count(),
  completed: count(),
  cancelled: count(),
  /** Every one of the eight categories. */
  by_category: z.record(enumField(STATE_CATEGORIES), count()),
})

/** How many tasks stood under it when it was accepted, or when work under it first started. */
const baselineSchema = strictObject({
  tasks: count(),
  basis: enumField(['accepted', 'started'] as const),
  taken_at: boundedText(ISO, 96),
})

/**
 * What its open tasks have left by their estimates, judged by done work of the whole store:
 * `basis` counts the different done tasks those estimates were judged by. Null with no open
 * task; zeros with `estimated` 0 when none of them has an estimate.
 */
const remainingSchema = strictObject({
  agent_seconds: z.number().nonnegative(),
  tokens: tokensSchema,
  estimated_api_cost_usd: z.number().nonnegative(),
  basis: count(),
  estimated: count(),
  unestimated: count(),
}).refine((left) => (left.estimated === 0) === (left.basis === 0), {
  message: 'expected done tasks behind the estimates exactly when one is given',
})

/** Why a row shows no count at acceptance: the first that holds. */
const BASELINE_ABSENT = ['filtered', 'partial', 'not_accepted', 'not_started', 'migrated'] as const

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
  tasks: tasksSchema,
  baseline: baselineSchema.nullable(),
  baseline_absent: enumField(BASELINE_ABSENT).nullable(),
  /** Without the items standing cancelled now; their children count by their own state. */
  spent: spentSchema,
  spent_with_cancelled: spentSchema,
  /** The sessions that spent on or wrote to any of its items, each once. */
  sessions: count(),
  /** The commits of a known repository attached to any of its items, each once. */
  commits: count(),
  /** Records of commits of no known repository: one commit may stand as two abbreviations. */
  commits_unknown_repository: count(),
  remaining: remainingSchema.nullable(),
}

/** A row stands in a state or derives one, never both; it shows a count or says why not. */
const standing = (row: {
  baseline: unknown
  baseline_absent: unknown
  container_state: unknown
  state: unknown
}) =>
  (row.state === null) !== (row.container_state === null) &&
  (row.baseline === null) !== (row.baseline_absent === null)
const STANDING = {
  message: 'expected a state or a container state, and a baseline or why it is absent',
}

const goalRowSchema = strictObject(goalRowShape).refine(standing, STANDING)

type VolumesGoalRow = z.infer<typeof goalRowSchema>
/** A row of the volumes read, with the rows of the stages under it that its scope holds. */
type VolumesGoalTree = VolumesGoalRow & { children: VolumesGoalTree[] }

const goalTreeSchema: z.ZodType<VolumesGoalTree> = z.lazy(() =>
  strictObject({ ...goalRowShape, children: z.array(goalTreeSchema) }).refine(standing, STANDING),
)

/**
 * What one day, or the whole period, brought: tasks created, tasks that came to be completed
 * or cancelled, the owner's decisions made in the interface, and commits of a known repository.
 */
const flowCounts = {
  created: count(),
  closed: count(),
  decisions: count(),
  commits: count(),
}
const MEASURES = ['created', 'closed', 'decisions', 'commits'] as const

const flowSchema = strictObject({
  /** Every day of the period on the caller's clock, oldest first. */
  days: z.array(strictObject({ day: boundedText(DAY, 10), ...flowCounts })),
  totals: strictObject(flowCounts),
  /** The pace of the scope's tasks in the shape of a chain's: the last days up to today. */
  pace: strictObject({ open: count(), recent: chainRecentSchema, series: chainSeriesSchema }),
}).refine(
  (flow) =>
    MEASURES.every(
      (measure) => flow.days.reduce((sum, day) => sum + day[measure], 0) === flow.totals[measure],
    ),
  { message: 'expected the days to add up to the totals' },
)

/** The median, the quartiles and the mean of one measure over a row's done tasks. */
const describedSchema = strictObject({
  median: z.number().nonnegative(),
  q1: z.number().nonnegative(),
  q3: z.number().nonnegative(),
  mean: z.number().nonnegative(),
})

/**
 * A row of the table of estimates: the scope's done tasks of one project and kind, or those of
 * them carrying one label. A row of several projects or of none names the space it stands in.
 */
const estimateRowSchema = strictObject({
  level: enumField(['project_kind', 'project_kind_label'] as const),
  project: projectGroupSchema,
  space: strictObject({ key: boundedText(SPACE_KEY, 8), name: title() }).nullable(),
  kind: enumField(['task', 'bug', 'improvement'] as const),
  label: label().nullable(),
  tasks: positiveInt(),
  agent_seconds: describedSchema,
  tokens_anew: describedSchema,
  estimated_api_cost_usd: describedSchema,
}).refine(
  (row) =>
    (row.level === 'project_kind') === (row.label === null) &&
    (row.space === null) === (row.project.id !== null),
  { message: 'expected a label exactly on a label row, and a space exactly with no one project' },
)

/** The scope's done work that estimates are judged by: how many tasks, and the table. */
const estimatesSchema = strictObject({
  min_basis: positiveInt(),
  basis: count(),
  rows: z.array(estimateRowSchema),
})

const volumesSchema = strictObject({
  scope: scopeSchema,
  period: strictObject({
    from: boundedText(MOMENT, 96),
    to: boundedText(MOMENT, 96),
    utc_offset: z.number().int().min(-840).max(840),
  }),
  /** The kinds and labels the read keeps its tasks to, or null when it keeps all its work. */
  filter: filterSchema.nullable(),
  /** When usage was first counted to an item in this store; null before any was. */
  measured_from: boundedText(ISO, 96).nullable(),
  counts: strictObject({
    /** The eight categories, always all, in the model's order. */
    categories: z.array(categorySchema).length(STATE_CATEGORIES.length),
    waiting_owner: waitingOwnerSchema,
    /**
     * The commits on no card of the scope's projects, or of the whole store: their list's total.
     * Null when that list cannot be read for the scope, a project only items name or a space
     * while the registry cannot be read: there is no list for the number to open.
     */
    unattached_commits: count().nullable(),
  }),
  /** The open goals and those that came to a close in the period. */
  goals: z.array(goalTreeSchema),
  outside: outsideSchema,
  flow: flowSchema,
  estimates: estimatesSchema,
}).refine(
  (read) =>
    read.counts.categories.every(
      (row) =>
        (row.goals === null) === (read.filter !== null) &&
        (row.stages === null) === (read.filter !== null),
    ),
  { message: 'expected goals and stages counted exactly when no filter keeps only tasks' },
)

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
