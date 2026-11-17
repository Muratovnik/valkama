/**
 * The one Planning read model, and the shapes every view is built from.
 *
 * Flat on purpose. The workflow, the items and the links arrive separately, so
 * Kanban groups by state, the list sorts, and the graph walks the edges — none
 * of them takes apart a grouping the server chose. A payload key shaped like a
 * lane would make Kanban the model again.
 */

import { commitSchema } from '@/shared/api/commitModel.ts'
import { confirmationSchema } from '@/shared/api/confirmationModel.ts'
import {
  blankable,
  boundedList,
  boundedText,
  parseContract,
  positiveInt,
  strictObject,
  uniqueList,
  z,
} from '@/shared/api/contract.ts'
import { executorSchema } from '@/shared/api/executorModel.ts'
import { itemProjectsField } from '@/shared/api/itemProjectsModel.ts'
import { liveWorkMapSchema } from '@/shared/api/liveWorkModel.ts'
import {
  EVENT_ACTIONS,
  EVENT_DETAIL_MAX,
  LABELS_DETAIL_MAX,
} from '@/shared/api/planningEventActions.ts'
import {
  conditionsChangedField,
  deferredField,
  lapsedClaimField,
  recordObject,
  returnedField,
  withheldField,
} from '@/shared/api/planningRecordRules.ts'
import {
  otherSpaceSchema,
  spaceBriefSchema,
  spaceIdentitySchema,
  TITLE,
} from '@/shared/api/planningSpaceModel.ts'
import { actor, callField, holderField, serverText } from '@/shared/api/planningText.ts'
import { enumField, ID, invalid, ISO, UUID } from '@/shared/api/platformApiGuards.ts'

export { SPACE_KEY, TITLE } from '@/shared/api/planningSpaceModel.ts'

export const PLANNING_READ_MODEL = 'valkama-planning-read-model' as const

export const STATE_CATEGORIES = [
  'triage',
  'deferred',
  'ready',
  'active',
  'review',
  'completed',
  'blocked',
  'cancelled',
] as const
/** A task kind, or a container: a goal, or a stage when it stands under a parent. */
export const WORK_ITEM_KINDS = ['bug', 'goal', 'improvement', 'stage', 'task'] as const
/**
 * What an accepted open goal or stage derives from the work under it, in the order the
 * work goes through them. It stands in no state a reader sees: its `state` is null.
 */
export const CONTAINER_STATES = ['not_started', 'in_progress', 'awaiting_confirmation'] as const
/** Why accepted work was accepted. */
const ACCEPTANCE_BASES = ['owner', 'assignment', 'inherited', 'label_rule', 'migrated'] as const
export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
export const LINK_KINDS = ['blocks', 'discovered-from', 'duplicates', 'relates-to'] as const
const REF_KINDS = ['commit', 'memory', 'session', 'url'] as const

/** `MAIN-142`: what a person types and what a URL carries. */
export const WORK_ITEM_REFERENCE = /^[A-Z][A-Z0-9]{1,7}-[1-9]\d{0,8}$/u
export const STATE_KEY = /^[a-z][a-z0-9-]{0,31}$/u

/** A state as it reads outside its workflow: no id, which only that workflow resolves. */
const publicStateShape = {
  key: boundedText(STATE_KEY, 32),
  name: boundedText(TITLE, 200),
  category: enumField(STATE_CATEGORIES),
  is_terminal: z.boolean(),
}
const stateShape = { state_id: boundedText(UUID, 36), ...publicStateShape }
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
  /** Ticked by a holder whose lease lapsed: a fresh tick confirms it before review or a close. */
  by_previous_holder: z.boolean(),
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
  /** Null for an accepted open goal or stage, which says what it derives in `container_state`. */
  state: stateSchema.nullable(),
  /** Whether work on it is still to finish, whatever its kind; `state` may be null. */
  open: z.boolean(),
  container_state: enumField(CONTAINER_STATES).nullable(),
  /** Why and when the work was accepted; null while it is not. */
  acceptance: strictObject({
    basis: enumField(ACCEPTANCE_BASES),
    at: boundedText(ISO, 96),
  }).nullable(),
  /** When it started: a task's own start, a container's earliest descendant's. */
  started_at: boundedText(ISO, 96).nullable(),
  /** The open items that block it, by reference. */
  waits_for: boundedList(boundedText(WORK_ITEM_REFERENCE, 20), 500),
  /** The cancelled items still linked to block it; only on open work, and only when there are any. */
  cancelled_blockers: boundedList(boundedText(WORK_ITEM_REFERENCE, 20), 500).optional(),
  claim_ref: actor(),
  claim_state: claimStateField(),
  parent_id: boundedText(UUID, 36).nullable(),
  labels: boundedList(boundedText(/^[^\u{0}]{1,64}$/u, 64), 32),
  /** The projects it changes; a goal or stage reads its tasks'. */
  projects: itemProjectsField(),
  /**
   * In a space's read, the space an item of another space lies in, which names one
   * of this space's projects; null for the space's own. Absent outside such a read.
   */
  other_space: otherSpaceSchema.nullable().optional(),
  source: blankable(512),
  checklist: boundedList(checklistStepSchema, 100),
  revision: positiveInt(true),
  created_at: boundedText(ISO, 96),
  updated_at: boundedText(ISO, 96),
  /** Workable now: its space's take-next queue may give it, and `withheld` is empty. */
  workable: z.boolean(),
  /** Why the queue does not give it, each reason once, in the server's one order. */
  withheld: withheldField(),
  /** Whose claim the lease sweep released, until the next claim. */
  lapsed_claim: lapsedClaimField(),
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
const workItemBriefSchema = recordObject({
  ...workItemBriefShape,
  comment_count: positiveInt(true),
})
/**
 * A row of a list read, the board's among them: the brief record and its place in its
 * space's queue, 1 given next, or null when the queue does not give it. The place is
 * the list's, so one item's preview and its full record do not carry it.
 */
const workItemRowSchema = recordObject({
  ...workItemBriefShape,
  comment_count: positiveInt(true),
  queue_order: positiveInt().nullable(),
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
  /** What an end that is an accepted open goal or stage derives; such an end names no state. */
  container_state: enumField(CONTAINER_STATES).nullable().optional(),
}

const linkEnd = z.object(linkEndState)

/**
 * A state is known, derived by an accepted open container, or said to be unavailable:
 * always one of the three.
 */
export const linkEndStateSaid = [
  (link: z.infer<typeof linkEnd>) => {
    if (link.state_category === undefined) return true
    if (link.state_category !== null)
      return typeof link.is_terminal === 'boolean' && link.state_unavailable === null
    if (typeof link.container_state === 'string')
      return link.is_terminal === false && link.state_unavailable === null
    return link.is_terminal === null && typeof link.state_unavailable === 'string'
  },
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

/** A detail is a short line, but for the label sets a `labels_changed` event carries. */
const eventSchema = strictObject({
  action: enumField(EVENT_ACTIONS),
  detail: blankable(LABELS_DETAIL_MAX),
  author: actor(),
  at: boundedText(ISO, 96),
  identity: eventIdentitySchema,
}).refine((event) => event.action === 'labels_changed' || event.detail.length <= EVENT_DETAIL_MAX, {
  message: 'expected a detail of at most 512 characters',
  path: ['detail'],
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
 * A session working on a goal or a stage: holding work under it, itself or through a
 * subagent, or following it or a container over it. The server lists at most 50.
 */
const participantSchema = strictObject({
  session: boundedText(/^[^\u{0}]{1,200}$/u, 200),
  client: blankable(200),
  label: holderField(),
  holds: boundedList(boundedText(WORK_ITEM_REFERENCE, 20), 20),
  follows: z.boolean(),
  last_seen: boundedText(ISO, 96),
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

const workItemSchema = recordObject({
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
  // Every full record carries them; optional while no view reads them.
  commits: z.array(commitSchema).optional(),
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
  // Who works on a goal or a stage: only the HTTP reads of one item carry it.
  participants: boundedList(participantSchema, 50).optional(),
  // What a goal's or stage's confirmer checks, only while it awaits confirmation.
  confirmation: confirmationSchema.optional(),
  // Why it waits while put off, and why it came back while it stands in triage after that.
  deferred: deferredField().optional(),
  returned: returnedField().optional(),
  // What became of steps taken off, reworded or moved to another item, once any were.
  conditions_changed: conditionsChangedField().optional(),
  // A transition answers with these; a plain read does not.
  warnings: z.array(serverText()).optional(),
  overridden: uniqueList(boundedText(ID, 64), 16).optional(),
  // A claim that started the item, and a release that put it back in the queue.
  started: stateMoveSchema.optional(),
  requeued: stateMoveSchema.optional(),
  // The holder whose claim a close ended.
  released: holderField().optional(),
  // The open items a close left with nothing open blocking them.
  freed: z.array(boundedText(WORK_ITEM_REFERENCE, 20)).optional(),
  // The goals and stages a write left with nothing open under them.
  awaiting_confirmation: z.array(boundedText(WORK_ITEM_REFERENCE, 20)).optional(),
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

/** The end of a link the read holds no item for, which may lie in another space. */
const otherSpaceEndSchema = strictObject({
  work_item_id: boundedText(UUID, 36),
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  title: boundedText(TITLE, 200),
  kind: enumField(WORK_ITEM_KINDS),
  // Null for an accepted open goal or stage, and for a state the store cannot resolve.
  state: strictObject(publicStateShape).nullable(),
  space: otherSpaceSchema,
})

const readModelSchema = strictObject({
  interface_version: z.literal(PLANNING_READ_MODEL, {
    message: `expected ${PLANNING_READ_MODEL}`,
  }),
  // The digest of everything else the model says, which the space's stream is opened with
  // so that it does not send this model again; optional, as a server older than it sends none.
  revision: boundedText(/^[0-9a-f]{64}$/u, 64).optional(),
  planning_spaces: z.array(spaceBriefSchema),
  planning_space: spaceIdentitySchema.nullable(),
  workflow: workflowSchema.nullable(),
  work_items: z.array(workItemRowSchema),
  links: z.array(edgeSchema),
  // The ends of those links the read holds no item for; optional, as an older server sends none.
  other_space_ends: z.array(otherSpaceEndSchema).optional(),
  stale_claims: z.array(staleClaimSchema),
  // Only the items with live work, by id; optional, as a server older than it sends none.
  live_work: liveWorkMapSchema.optional(),
})
  .refine((payload) => (payload.planning_space === null) === (payload.workflow === null), {
    message: 'a space and its workflow arrive together or not at all',
  })
  .refine(
    (payload) =>
      payload.work_items.every(
        (item) =>
          item.state === null ||
          // Another space's item stands in a state of its own space's workflow.
          (item.other_space ?? null) !== null ||
          payload.workflow?.states.some((state) => state.state_id === item.state?.state_id),
      ),
    { message: 'every item names a state its workflow declares' },
  )

export type WorkflowState = z.infer<typeof workflowStateSchema>
export type ContainerState = (typeof CONTAINER_STATES)[number]
export type WorkItemBrief = z.infer<typeof workItemBriefSchema>
export type WorkItemRow = z.infer<typeof workItemRowSchema>
export type WorkItem = z.infer<typeof workItemSchema>
export type WorkItemAgent = z.infer<typeof workItemAgentSchema>
export type PlanningWorkflow = z.infer<typeof workflowSchema>
export type PlanningReadModel = z.infer<typeof readModelSchema>
export type PlanningEdge = z.infer<typeof edgeSchema>

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

/**
 * The items that can be started right now, as the server answered.
 *
 * Not recomputed here: being workable asks about a claim, a container and an open
 * blocker, and the Board era had each view answer for itself, so a held item was
 * workable in one list and not in another.
 */
export function workableIds(items: readonly WorkItemBrief[]): Set<string> {
  return new Set(items.filter((item) => item.workable).map((item) => item.work_item_id))
}
