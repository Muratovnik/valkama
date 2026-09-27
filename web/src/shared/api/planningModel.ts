/**
 * The one Planning read model, and the shapes every view is built from.
 *
 * Flat on purpose. The workflow, the items and the links arrive separately, so
 * Kanban groups by state, the list sorts, and the graph walks the edges — none
 * of them takes apart a grouping the server chose. A payload key shaped like a
 * lane would make Kanban the model again.
 */

import {
  boundedList,
  boundedText,
  parseContract,
  positiveInt,
  strictObject,
  uniqueList,
  z,
} from '@/shared/api/contract.ts'
import { invalid } from '@/shared/api/platformActionRef.ts'
import { enumField, ID, ISO, PROJECT_ID, UUID } from '@/shared/api/platformApiGuards.ts'

const PLANNING_READ_MODEL = 'valkama-planning-read-model' as const
const PLANNING_API = 'valkama-planning-api' as const

const STATE_CATEGORIES = [
  'backlog',
  'queued',
  'active',
  'review',
  'completed',
  'blocked',
  'cancelled',
] as const
export const WORK_ITEM_KINDS = ['bug', 'epic', 'improvement', 'task'] as const
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export const LINK_KINDS = ['blocks', 'discovered-from', 'duplicates', 'relates-to'] as const
const REF_KINDS = ['commit', 'memory', 'session', 'url'] as const
const EVENT_ACTIONS = [
  'created',
  'transitioned',
  'claimed',
  'released',
  'taken_over',
  'linked',
  'unlinked',
  'checklist_replaced',
  'checklist_claimed',
  'checklist_taken_over',
  'checklist_released',
  'checklist_completed',
  'checklist_reopened',
  'summarized',
  'execution_attached',
  'overridden',
] as const

/** `VAL-142`: what a person types and what a URL carries. */
export const WORK_ITEM_REFERENCE = /^[A-Z][A-Z0-9]{1,7}-[1-9]\d{0,8}$/u
const SPACE_KEY = /^[A-Z][A-Z0-9]{1,7}$/u
const STATE_KEY = /^[a-z][a-z0-9-]{0,31}$/u
const TITLE = /^[^\u{0}]{1,200}$/u

/**
 * A field that may be blank, which several of these are: an unheld item has no
 * claim, an item raised by hand has no source, an event needs no detail.
 * `boundedText` requires one character, so blank needs its own reader rather
 * than a pattern pretending an empty string is a value.
 */
function blankable(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => !/\u{0}/u.test(value), { message: 'expected bounded string' })
}

/** Free text an agent wrote about itself, bounded and never resolved. */
const actor = () => blankable(128)

const stateShape = {
  state_id: boundedText(UUID, 36),
  key: boundedText(STATE_KEY, 32),
  name: boundedText(TITLE, 200),
  category: enumField(STATE_CATEGORIES),
  is_terminal: z.boolean(),
}
const stateSchema = strictObject(stateShape)
const workflowStateSchema = strictObject({ ...stateShape, position: positiveInt(true) })

const checklistStepSchema = strictObject({
  id: boundedText(UUID, 36),
  text: boundedText(/^[^\u{0}]{1,1000}$/u, 1000),
  done: z.boolean(),
  claimed_by: actor(),
  done_by: actor(),
})

const workItemBriefShape = {
  work_item_id: boundedText(UUID, 36),
  planning_space_id: boundedText(UUID, 36),
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  number: positiveInt(),
  title: boundedText(TITLE, 200),
  kind: enumField(WORK_ITEM_KINDS),
  priority: enumField(PRIORITIES),
  state: stateSchema,
  claim_ref: actor(),
  parent_id: boundedText(UUID, 36).nullable(),
  labels: boundedList(boundedText(/^[^\u{0}]{1,64}$/u, 64), 32),
  source: blankable(512),
  checklist: boundedList(checklistStepSchema, 100),
  revision: positiveInt(true),
  created_at: boundedText(ISO, 96),
  updated_at: boundedText(ISO, 96),
  /** Somebody's parent, so grouping rather than work in itself. */
  container: z.boolean(),
  /** Startable right now: unheld, uncontained, unblocked, not yet started. */
  ready: z.boolean(),
}
const workItemBriefSchema = strictObject({
  ...workItemBriefShape,
  comment_count: positiveInt(true),
})

const summarySchema = strictObject({
  done: blankable(4000),
  next: blankable(4000),
  why: blankable(4000).optional(),
})

const linkSchema = strictObject({
  kind: enumField(LINK_KINDS),
  direction: enumField(['incoming', 'outgoing'] as const),
  work_item_id: boundedText(UUID, 36),
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  title: boundedText(TITLE, 200),
})

const refSchema = strictObject({
  kind: enumField(REF_KINDS),
  value: boundedText(/^[^\u{0}]{1,512}$/u, 512),
  label: blankable(200),
  author: actor(),
  at: boundedText(ISO, 96),
})

const commentSchema = strictObject({
  author: actor(),
  body: boundedText(/^[^\u{0}]{1,8000}$/u, 8000),
  at: boundedText(ISO, 96),
})

const eventSchema = strictObject({
  action: enumField(EVENT_ACTIONS),
  detail: blankable(512),
  author: actor(),
  at: boundedText(ISO, 96),
})

const workItemSchema = strictObject({
  ...workItemBriefShape,
  comment_count: positiveInt(true).optional(),
  description: blankable(20_000),
  summary: summarySchema.nullable(),
  links: boundedList(linkSchema, 200),
  refs: boundedList(refSchema, 200),
  comments: boundedList(commentSchema, 500),
  events: boundedList(eventSchema, 1000),
  // A transition answers with these; a plain read does not.
  warnings: boundedList(boundedText(/^[^\u{0}]{1,512}$/u, 512), 32).optional(),
  overridden: uniqueList(boundedText(ID, 64), 16).optional(),
})

const spaceIdentityShape = {
  planning_space_id: boundedText(UUID, 36),
  project_id: boundedText(PROJECT_ID, 160),
  name: boundedText(TITLE, 200),
  key: boundedText(SPACE_KEY, 8),
  provider_kind: enumField(['local'] as const),
}
const spaceIdentitySchema = strictObject(spaceIdentityShape)
const spaceBriefSchema = strictObject({
  ...spaceIdentityShape,
  work_items: positiveInt(true),
  open: positiveInt(true),
  active: positiveInt(true),
  completed: positiveInt(true),
  updated_at: boundedText(ISO, 96),
})

const workflowSchema = strictObject({
  workflow_id: boundedText(UUID, 36),
  name: boundedText(TITLE, 200),
  initial_state_id: boundedText(UUID, 36),
  states: boundedList(workflowStateSchema, 64).min(1),
  transitions: boundedList(
    strictObject({ from: boundedText(UUID, 36), to: boundedText(UUID, 36) }),
    4096,
  ),
})

//: A parent edge is derived from the item's own `parent_id` rather than stored
//: as a link, so the graph's edge kinds are the link kinds plus that one.
const GRAPH_EDGE_KINDS = [...LINK_KINDS, 'parent'] as const

const edgeSchema = strictObject({
  from: boundedText(UUID, 36),
  to: boundedText(UUID, 36),
  kind: enumField(GRAPH_EDGE_KINDS),
})

/**
 * A held item nothing has touched for long enough that its ownership reads as
 * abandoned. Named by reference and state key, because a reader acts on it by
 * reference and the state is the space's own word.
 */
const staleClaimSchema = strictObject({
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  title: boundedText(TITLE, 200),
  claim_ref: actor(),
  state: boundedText(STATE_KEY, 32),
  last_event: boundedText(ISO, 96),
  quiet_days: positiveInt(true),
})

const readModelSchema = strictObject({
  interface_version: z.literal(PLANNING_READ_MODEL, {
    message: `expected ${PLANNING_READ_MODEL}`,
  }),
  planning_spaces: boundedList(spaceBriefSchema, 128),
  planning_space: spaceIdentitySchema.nullable(),
  workflow: workflowSchema.nullable(),
  work_items: boundedList(workItemBriefSchema, 2000),
  links: boundedList(edgeSchema, 8000),
  stale_claims: boundedList(staleClaimSchema, 500),
})
  .refine((payload) => (payload.planning_space === null) === (payload.workflow === null), {
    message: 'a space and its workflow arrive together or not at all',
  })
  .refine(
    (payload) =>
      payload.work_items.every((item) =>
        payload.workflow?.states.some((state) => state.state_id === item.state.state_id),
      ),
    { message: 'every item names a state its workflow declares' },
  )

const activityEntrySchema = strictObject({
  // The event's own row id: what lets a reader say "newer than what I already
  // showed" without comparing timestamps that several events share.
  event_id: positiveInt(),
  work_item_id: boundedText(UUID, 36),
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  title: boundedText(TITLE, 200),
  action: enumField(EVENT_ACTIONS),
  detail: blankable(512),
  // The category of the state the detail names, when it names one; an event
  // that is not a transition has none.
  state_category: enumField(STATE_CATEGORIES).nullable(),
  author: actor(),
  at: boundedText(ISO, 96),
})

const apiVersion = z.literal(PLANNING_API, { message: `expected ${PLANNING_API}` })
/** The refusal shape every neutral write answers with when it says no. */
const refusalSchema = strictObject({
  error: strictObject({
    code: boundedText(/^[a-z_]{1,64}$/u, 64),
    message: boundedText(/^[^\u{0}]{1,1000}$/u, 1000),
    expected: positiveInt(true).optional(),
    actual: positiveInt(true).optional(),
  }),
})

/** The typed unavailable a read answers with while the cutover is pending. */
const pendingSchema = strictObject({
  interface_version: apiVersion,
  state: strictObject({
    interface_version: z.literal('valkama-ui-state', { message: 'expected valkama-ui-state' }),
    status: z.literal('unavailable', { message: 'expected unavailable' }),
    reason: boundedText(/^[^\u{0}]{1,512}$/u, 512),
  }),
})

export type WorkflowState = z.infer<typeof workflowStateSchema>
export type WorkItemBrief = z.infer<typeof workItemBriefSchema>
export type WorkItem = z.infer<typeof workItemSchema>
export type PlanningSpaceBrief = z.infer<typeof spaceBriefSchema>
export type PlanningWorkflow = z.infer<typeof workflowSchema>
export type PlanningReadModel = z.infer<typeof readModelSchema>
export type PlanningActivityEntry = z.infer<typeof activityEntrySchema>
export type PlanningEdge = z.infer<typeof edgeSchema>
export type PlanningRefusal = z.infer<typeof refusalSchema>
export type PlanningPending = z.infer<typeof pendingSchema>

export function validateReadModel(value: unknown, path = 'planning'): PlanningReadModel {
  return parseContract(readModelSchema, value, path, invalid)
}

export function validateWorkItemRecord(value: unknown, path = 'planning.workItem'): WorkItem {
  return parseContract(workItemSchema, value, path, invalid)
}

export function readRefusal(value: unknown): PlanningRefusal | null {
  const parsed = refusalSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function readPending(value: unknown): PlanningPending | null {
  const parsed = pendingSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** Items grouped by state, which is a view's decision and not the model's. */
export function byState(
  workflow: PlanningWorkflow,
  items: readonly WorkItemBrief[],
): { items: WorkItemBrief[]; state: WorkflowState }[] {
  return [...workflow.states]
    .sort((left, right) => left.position - right.position)
    .map((state) => ({
      state,
      items: items.filter((item) => item.state.state_id === state.state_id),
    }))
}

/** Which items nothing unfinished blocks, computed the same way the graph does. */
/**
 * The items that can be started right now, as the server answered.
 *
 * Not recomputed here: readiness asks about a claim, a container and an open
 * blocker, and the Board era had each view answer for itself, so a held item was
 * workable in one list and not in another.
 */
export function readyIds(items: readonly WorkItemBrief[]): Set<string> {
  return new Set(items.filter((item) => item.ready).map((item) => item.work_item_id))
}
