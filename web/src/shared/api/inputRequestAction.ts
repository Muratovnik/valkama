/**
 * The `action` part of a question about an agent's write that waits for the owner: what
 * waits, who asked it and when, why, what it proposes and how it ended. Read only: the
 * views do not show it yet, but a strict reader that did not know it would refuse the
 * whole list of questions it stands in.
 */

import { boundedList, boundedText, strictObject, z } from '@/shared/api/contract.ts'
import { summarySchema, TITLE, WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { holderField } from '@/shared/api/planningText.ts'
import { ISO, UUID } from '@/shared/api/platformApiGuards.ts'

/** The points a write waits for the owner at, as the store's CHECK holds them. */
const ACTION_POINTS = [
  'finding',
  'proposed_goal',
  'task_in_goal',
  'cancel_outside',
  'cancel_shared',
  'condition',
  'goal_close',
  'goal_defer',
] as const
/** How a waiting write ended, as the store's CHECK holds them. */
export const ACTION_OUTCOMES = ['carried_out', 'declined', 'dropped', 'withdrawn'] as const

const reference = boundedText(WORK_ITEM_REFERENCE, 20)
const title = boundedText(TITLE, 200)
const at = boundedText(ISO, 96)
const step = z.string().min(1).max(8000)

/** One open item a cancel closes, where it stands and who holds it or a step of it. */
const cancelSchema = strictObject({
  reference,
  title,
  kind: z.string().min(1).max(64),
  /** Null for an accepted open goal or stage, which stands where `container_state` says. */
  state: strictObject({
    key: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    category: z.string().min(1).max(64),
  }).nullable(),
  container_state: z.string().min(1).max(64).nullable(),
  holder: boundedList(holderField()),
})

/** One open item outside the cancel that waits on an item of it. */
const dependentSchema = strictObject({
  reference,
  title,
  kind: z.string().min(1).max(64),
  waits_on: reference,
  how: z.enum(['blocks', 'deferred']),
})

/**
 * What the write proposes, by its point: nothing for a goal or a task, which the card
 * itself shows; `state` for a cancel, `until` for putting a goal off, `removed` and
 * `rewritten` for a condition, `summary` for a goal's close (empty when it gave none);
 * for a group of findings its goal's `conditions` when asked, its `items`, the agent's
 * `answer`, `until` with `later`, and `why`.
 */
const proposedSchema = strictObject({
  state: z.string().min(1).max(64).optional(),
  until: z.string().min(1).optional(),
  conditions: boundedList(step).optional(),
  items: boundedList(strictObject({ reference, title })).optional(),
  answer: z.enum(['do', 'later', 'drop']).optional(),
  why: z.string().min(1).max(500).optional(),
  removed: boundedList(strictObject({ id: z.string().min(1).max(64), text: step })).optional(),
  rewritten: boundedList(
    strictObject({ id: z.string().min(1).max(64), from: step, to: step }),
  ).optional(),
  summary: z.union([summarySchema, strictObject({})]).optional(),
})

export const actionSchema = strictObject({
  id: boundedText(UUID, 36),
  point: z.enum(ACTION_POINTS),
  /** As a holder is named; `Valkama` for a write it asked itself. */
  asked_by: z.string().min(1).max(200),
  asked_at: at,
  reason: z.string().max(512).nullable(),
  proposed: proposedSchema,
  /** On a goal's or a cancel's question: the list the cancel closes, as it stands now. */
  cancel_list: strictObject({
    cancels: z.array(cancelSchema),
    dependents: z.array(dependentSchema),
    list_token: z.string().min(1).max(64),
  }).optional(),
  /** On a cancel of work other sessions do: what each session asked answered. */
  consent: z
    .array(
      strictObject({
        session: holderField(),
        answer: z.string().min(1).max(64).nullable(),
        reason: z.string().max(8000).nullable(),
        at: at.nullable(),
      }),
    )
    .optional(),
  outcome: z.enum(ACTION_OUTCOMES).nullable(),
})
