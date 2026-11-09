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
import { executorSchema } from '@/shared/api/executorModel.ts'
import { liveWorkMapSchema } from '@/shared/api/liveWorkModel.ts'
import { EVENT_ACTIONS } from '@/shared/api/planningEventActions.ts'
import { enumField, ID, invalid, ISO, PROJECT_ID, UUID } from '@/shared/api/platformApiGuards.ts'

export const PLANNING_READ_MODEL = 'valkama-planning-read-model' as const
const PLANNING_API = 'valkama-planning-api' as const

export const STATE_CATEGORIES = [
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

/** `MAIN-142`: what a person types and what a URL carries. */
export const WORK_ITEM_REFERENCE = /^[A-Z][A-Z0-9]{1,7}-[1-9]\d{0,8}$/u
export const SPACE_KEY = /^[A-Z][A-Z0-9]{1,7}$/u
export const STATE_KEY = /^[a-z][a-z0-9-]{0,31}$/u
export const TITLE = /^[^\u{0}]{1,200}$/u

/**
 * A field that may be blank, which several of these are: an unheld item has no
 * claim, an item raised by hand has no source, an event needs no detail.
 * `boundedText` requires one character, so blank needs its own reader rather
 * than a pattern pretending an empty string is a value.
 */
export function blankable(max: number) {
  return z
    .string()
    .max(max)
    .refine((value) => !/\u{0}/u.test(value), { message: 'expected bounded string' })
}

/**
 * Text the server composes itself (a warning, a refusal joining its guards),
 * which no write bounds: present and free of NUL, at whatever length it runs.
 */
const serverText = () =>
  z
    .string()
    .min(1)
    .refine((value) => !/\u{0}/u.test(value), { message: 'expected text' })

/** Free text an agent wrote about itself, bounded and never resolved. */
const actor = () => blankable(128)
/** A holder that is somebody: `claim_ref` as it reads while the item is held. */
const holderField = () => boundedText(/^[^\u{0}]{1,128}$/u, 128)

const stateShape = {
  state_id: boundedText(UUID, 36),
  key: boundedText(STATE_KEY, 32),
  name: boundedText(TITLE, 200),
  category: enumField(STATE_CATEGORIES),
  is_terminal: z.boolean(),
}
const stateSchema = strictObject(stateShape)
const workflowStateSchema = strictObject({ ...stateShape, position: positiveInt(true) })

/**
 * Whether the session behind a claim is still there, computed by the server at
 * every read. `unconfirmed` is a claim no session proved — every claim older
 * than leases, and every claim made in this browser.
 */
export const CLAIM_STATES = ['live', 'stale', 'unconfirmed'] as const
const claimStateField = () => enumField(CLAIM_STATES).nullable()

const stepText = () => boundedText(/^[^\u{0}]{1,1000}$/u, 1000)
const checklistStepSchema = strictObject({
  id: boundedText(UUID, 36),
  text: stepText(),
  done: z.boolean(),
  claimed_by: actor(),
  done_by: actor(),
  executor: executorSchema.optional(),
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
  claim_state: claimStateField(),
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
  /**
   * When a finished item closed: its latest transition. Null for open work, and
   * absent from a server that predates it.
   */
  closed_at: boundedText(ISO, 96).nullable().optional(),
  /**
   * Who held a finished item when it closed, as `claim_ref` names a holder. A
   * close ends the claim, so `claim_ref` is blank by then. Null for open work
   * and for an item closed unheld.
   */
  last_claim_ref: holderField().nullable().optional(),
}
const workItemBriefSchema = strictObject({
  ...workItemBriefShape,
  comment_count: positiveInt(true),
})

const summarySchema = strictObject({
  done: blankable(4000),
  next: blankable(4000),
  why: blankable(4000).optional(),
  /** What hindered the work itself: `none`, or a line per hindrance. */
  friction: blankable(4000).optional(),
})

/**
 * The state a link names for the item at one of its ends, which may live in
 * another space and so another workflow: null, with the reason beside it, when
 * the store cannot resolve it, and absent from a server that predates it.
 * Neither means that end is open.
 */
export const linkEndState = {
  state_name: boundedText(TITLE, 200).nullable().optional(),
  state_category: enumField(STATE_CATEGORIES).nullable().optional(),
  is_terminal: z.boolean().nullable().optional(),
  state_unavailable: enumField(['state_missing'] as const)
    .nullable()
    .optional(),
}

/** A state is either known or said to be unavailable, never neither. */
export const linkEndStateSaid = [
  (link: {
    is_terminal?: boolean | null
    state_category?: string | null
    state_unavailable?: string | null
  }) =>
    link.state_category === undefined ||
    (link.state_category === null
      ? link.is_terminal === null && typeof link.state_unavailable === 'string'
      : typeof link.is_terminal === 'boolean' && link.state_unavailable === null),
  { message: 'Link state is neither known nor said to be unavailable' },
] as const

/**
 * A link and the state of the item at its other end. A finished blocker blocks
 * nothing, and the item's own state cannot say so.
 */
const linkSchema = strictObject({
  kind: enumField(LINK_KINDS),
  direction: enumField(['incoming', 'outgoing'] as const),
  work_item_id: boundedText(UUID, 36),
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  title: boundedText(TITLE, 200),
  ...linkEndState,
}).refine(...linkEndStateSaid)

const refSchema = strictObject({
  kind: enumField(REF_KINDS),
  value: boundedText(/^[^\u{0}]{1,512}$/u, 512),
  label: blankable(200),
  author: actor(),
  at: boundedText(ISO, 96),
})

/**
 * A root's resolved mark: who set it, when, and the one-line decision, which may
 * be blank. `by_person` is the server's fact about the call, as on a comment.
 */
export const resolutionSchema = strictObject({
  at: boundedText(ISO, 96),
  by: actor(),
  by_person: z.boolean().nullable(),
  text: blankable(280).refine((value) => !/[\r\n]/u.test(value), { message: 'expected one line' }),
})

/**
 * Who wrote a comment and where it hangs. `by_person` is true for a write that
 * came through the interface, false for another call, and null for a row with no
 * call. A root has neither parent; a reply has one and never a mark.
 */
const commentIdentity = {
  id: positiveInt(),
  author: actor(),
  by_person: z.boolean().nullable(),
  resolution: resolutionSchema.nullable(),
  /** The other items the comment told, by reference; a number in its text tells nobody. */
  mentions: boundedList(boundedText(WORK_ITEM_REFERENCE, 20), 20).optional(),
  /** Present only on a comment that waits for a reply, with whether another session or a person gave one. */
  awaits_reply: z.literal(true).optional(),
  answered: z.boolean().optional(),
}

/**
 * A text on another item that told this one: `in` a comment, a report, the summary or
 * the description, the first three by `comment_id`. `from` is the item the words stand
 * on now and `quote` what they said; both are null once that item is deleted.
 */
const mentionRecordSchema = strictObject({
  in: enumField(['comment', 'report', 'summary', 'description'] as const),
  comment_id: positiveInt().nullable(),
  from: boundedText(WORK_ITEM_REFERENCE, 20).nullable(),
  at: boundedText(ISO, 96),
  by_person: z.boolean().nullable(),
  author: actor(),
  quote: blankable(300).nullable(),
})
/**
 * Who will hear an item a write told, as the write answers it: the holders of its claim
 * and its steps, and `told` when nobody will.
 */
export const toldSchema = strictObject({
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  holders: boundedList(holderField(), 101),
  told: serverText().optional(),
})
const commentSchema = z.union([
  strictObject({
    ...commentIdentity,
    kind: z.literal('comment'),
    checklist_item_id: boundedText(UUID, 36).nullable().optional(),
    checklist_item_text: blankable(1000).nullable().optional(),
    report: z.null(),
    body: boundedText(/^[^\u{0}]{1,8000}$/u, 8000),
    at: boundedText(ISO, 96),
    reply_to: positiveInt().nullable(),
    reply_to_request: boundedText(UUID, 36).nullable(),
  }).refine(
    (comment) =>
      (comment.reply_to === null && comment.reply_to_request === null) ||
      ((comment.reply_to === null) !== (comment.reply_to_request === null) &&
        !comment.checklist_item_id &&
        comment.resolution === null),
    { message: 'a reply has one parent, no step and no mark' },
  ),
  // A report is always a root: no write takes a parent for one.
  strictObject({
    ...commentIdentity,
    kind: z.literal('report'),
    checklist_item_id: z.null().optional(),
    checklist_item_text: z.null().optional(),
    report: summarySchema,
    body: blankable(8000),
    at: boundedText(ISO, 96).nullable(),
    reply_to: z.null(),
    reply_to_request: z.null(),
  }),
])

/** A client-reported id, never resolved here; the server bounds it at 200. */
const callField = () => blankable(200).nullable()

/**
 * Who made the call that wrote an event, as far as the call proved it. `author`
 * is what the caller wrote about itself; this is what the call carried. An
 * event older than identity has no source and names nobody.
 */
const eventIdentitySchema = strictObject({
  state: enumField(['confirmed', 'unconfirmed'] as const),
  source: boundedText(/^[a-z][a-z-]{0,63}$/u, 64).nullable(),
  session_id: callField(),
  agent_id: callField(),
})

const eventSchema = strictObject({
  action: enumField(EVENT_ACTIONS),
  detail: blankable(512),
  author: actor(),
  at: boundedText(ISO, 96),
  identity: eventIdentitySchema,
})

/**
 * A session that follows the item, as the call that subscribed proved it. `label` is the holder
 * a claim of that session, or of that agent of it, records: the server's own rule, by the
 * channel that proved the session, so it is the very text `claim_ref` holds.
 */
const subscriberSchema = strictObject({
  session: blankable(200),
  client: callField(),
  agent: callField(),
  label: holderField(),
  since: boundedText(ISO, 96),
})

/**
 * The lease behind a claim. `holder` is `claim_ref`, the author the claim was
 * signed with: a launch signs its runner, and the owner's own claims sign
 * `user`, so the holder is never inferred from where the claim came from.
 */
const claimSchema = strictObject({
  holder: holderField(),
  state: enumField(CLAIM_STATES),
  session_id: callField(),
  agent_id: callField(),
  source: boundedText(/^[a-z][a-z-]{0,63}$/u, 64).nullable(),
  acquired_at: boundedText(ISO, 96).nullable(),
  last_seen: boundedText(ISO, 96).nullable(),
  expires_at: boundedText(ISO, 96).nullable(),
  executor: executorSchema.optional(),
})

/** Where a claim or a release moved an item: the state keys before and after. */
const stateMoveSchema = strictObject({
  from: boundedText(STATE_KEY, 32),
  to: boundedText(STATE_KEY, 32),
})

/** An agent on an item: only the card's read carries the list. */
const workItemAgentSchema = strictObject({
  // A call names its session and agent in up to 200 characters, and an agent
  // on the card is read from those calls.
  agent_id: boundedText(/^[^\u{0}]{1,200}$/u, 200),
  session_id: boundedText(/^[^\u{0}]{1,200}$/u, 200),
  agent_type: blankable(200),
  label: blankable(200),
  started_at: boundedText(ISO, 96).nullable(),
  last_activity_at: boundedText(ISO, 96).nullable(),
  ended_at: boundedText(ISO, 96).nullable(),
  steps: boundedList(strictObject({ id: boundedText(UUID, 36), text: stepText() }), 100),
  link: enumField(['exact', 'claim'] as const),
  coordinator_items: positiveInt().nullable(),
  executor: executorSchema.optional(),
})

const workItemSchema = strictObject({
  ...workItemBriefShape,
  agents: z.array(workItemAgentSchema).optional(),
  claim: claimSchema.nullable(),
  /** Who `last_claim_ref` names and what opening them would reach: only the card reads it. */
  last_claim_executor: executorSchema.optional(),
  comment_count: positiveInt(true).optional(),
  description: blankable(20_000),
  summary: summarySchema.nullable(),
  summary_comment_id: positiveInt().nullable(),
  // The server counts neither, so neither does the card.
  links: z.array(linkSchema),
  refs: z.array(refSchema),
  // Unbounded on purpose: the server sends the whole record, however long the
  // discussion and the history grew, and a card refused for its length is lost.
  // Each entry stays bounded.
  comments: z.array(commentSchema),
  events: z.array(eventSchema),
  // The read of one item carries the newest of these and how many there are.
  mentions: boundedList(mentionRecordSchema, 50).optional(),
  mentions_total: positiveInt(true).optional(),
  // A write whose text told other items answers who will hear them.
  mentions_told: boundedList(toldSchema, 20).optional(),
  subscribers: z.array(subscriberSchema).optional(),
  // A transition answers with these; a plain read does not.
  warnings: z.array(serverText()).optional(),
  overridden: uniqueList(boundedText(ID, 64), 16).optional(),
  // A claim that started the item, and a release that put it back in the queue.
  started: stateMoveSchema.optional(),
  requeued: stateMoveSchema.optional(),
  // The holder whose claim a close ended.
  released: holderField().optional(),
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
  // No write bounds a workflow: an upgraded store keeps every column it had.
  states: z.array(workflowStateSchema).min(1),
  transitions: z.array(strictObject({ from: boundedText(UUID, 36), to: boundedText(UUID, 36) })),
})

//: A parent edge is derived from the item's own `parent_id` rather than stored
//: as a link, so the graph's edge kinds are the link kinds plus that one.
const GRAPH_EDGE_KINDS = [...LINK_KINDS, 'parent'] as const

/**
 * A link with an end in the space, and the state of its source — the end a
 * reader asks about, since a block holds while its source is open. The source
 * may live in another space, so its reference and state come with the link
 * rather than from the space's items. A chain's edges name their source the same way.
 */
const edgeSchema = strictObject({
  from: boundedText(UUID, 36),
  to: boundedText(UUID, 36),
  kind: enumField(GRAPH_EDGE_KINDS),
  reference: boundedText(WORK_ITEM_REFERENCE, 20).optional(),
  ...linkEndState,
}).refine(...linkEndStateSaid)

/**
 * A held item nothing has touched for long enough that its ownership reads as
 * abandoned. Named by reference and state key, because a reader acts on it by
 * reference and the state is the space's own word.
 */
const staleClaimSchema = strictObject({
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  title: boundedText(TITLE, 200),
  claim_ref: actor(),
  claim_state: claimStateField(),
  state: boundedText(STATE_KEY, 32),
  last_event: boundedText(ISO, 96),
  quiet_days: positiveInt(true),
})

const readModelSchema = strictObject({
  interface_version: z.literal(PLANNING_READ_MODEL, {
    message: `expected ${PLANNING_READ_MODEL}`,
  }),
  planning_spaces: z.array(spaceBriefSchema),
  planning_space: spaceIdentitySchema.nullable(),
  workflow: workflowSchema.nullable(),
  work_items: z.array(workItemBriefSchema),
  links: z.array(edgeSchema),
  stale_claims: z.array(staleClaimSchema),
  // Only the items with live work, by id; optional, as a server older than it sends none.
  live_work: liveWorkMapSchema.optional(),
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

const apiVersion = z.literal(PLANNING_API, { message: `expected ${PLANNING_API}` })
/** The refusal shape every neutral write answers with when it says no. */
const refusalSchema = strictObject({
  error: strictObject({
    code: boundedText(/^[a-z_]{1,64}$/u, 64),
    message: serverText(),
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
export type WorkItemAgent = z.infer<typeof workItemAgentSchema>
export type PlanningWorkflow = z.infer<typeof workflowSchema>
export type PlanningReadModel = z.infer<typeof readModelSchema>
export type PlanningEdge = z.infer<typeof edgeSchema>
export type PlanningRefusal = z.infer<typeof refusalSchema>
export type PlanningPending = z.infer<typeof pendingSchema>

export function validateReadModel(value: unknown, path = 'planning'): PlanningReadModel {
  return parseContract(readModelSchema, value, path, invalid)
}

export function validateWorkItemRecord(value: unknown, path = 'planning.workItem'): WorkItem {
  return parseContract(workItemSchema, value, path, invalid)
}

/** The brief record a space's list carries, as one item's preview reads it alone. */
export function validateWorkItemBrief(value: unknown, path = 'planning.workItem'): WorkItemBrief {
  return parseContract(workItemBriefSchema, value, path, invalid)
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
