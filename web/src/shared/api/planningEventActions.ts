import { blankable, boundedText, strictObject, z } from '@/shared/api/contract.ts'
import { DECISION_POINTS } from '@/shared/api/planningDecisionPoints.ts'
import { actor, callField } from '@/shared/api/planningText.ts'
import { enumField, ISO } from '@/shared/api/platformApiGuards.ts'

/**
 * Every action a work item's history event can name, as the store's CHECK constraint
 * holds them. A strict reader refuses an event whose action is not here, so the list
 * grows with the store's in the same release.
 */
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
  'request_created',
  'request_answered',
  'request_declined',
  'request_expired',
  'request_changed',
  'comment_resolved',
  'comment_reopened',
  'mentioned',
  'labels_changed',
  'overridden',
  'accepted',
  'opened',
  'child_left',
  'awaiting_confirmation',
  'returned',
  'converted',
  'checklist_removed',
  'split_off',
  'split_from',
  'action_dropped',
  'commit_attached',
  'commit_detached',
  'commit_rewritten',
] as const

/** The longest detail any event but `labels_changed` carries. */
export const EVENT_DETAIL_MAX = 512
/**
 * The server's bound on a `labels_changed` detail (`model.LABELS_DETAIL_LIMIT`): both sets of
 * 32 labels of 64 characters, every character written as a six-character JSON escape.
 */
export const LABELS_DETAIL_MAX = 24_785

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
export const eventSchema = strictObject({
  action: enumField(EVENT_ACTIONS),
  detail: blankable(LABELS_DETAIL_MAX),
  author: actor(),
  at: boundedText(ISO, 96),
  identity: eventIdentitySchema,
  /** The decision point an agent's own decision marked this event with; absent on any other. */
  point: z.enum(DECISION_POINTS).optional(),
}).refine((event) => event.action === 'labels_changed' || event.detail.length <= EVENT_DETAIL_MAX, {
  message: 'expected a detail of at most 512 characters',
  path: ['detail'],
})
