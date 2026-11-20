/**
 * The key and values of a text the service composed, beside the English text an agent reads:
 * a question's `prompt_message` and a decision's `what_message`. `server/planning/composed.py`
 * defines each key with the values it carries, and `docs/connection-contract.md` («Texts the
 * service composes») lists them; the interface says the text from its own catalogue, never by
 * reading the English. A text an agent wrote, and one written before the service stored keys,
 * has none and is shown as written.
 *
 * Strict like every planning contract: a key or a value nobody declared is refused, so the two
 * lists grow with the server's in the same release.
 */
import { boundedList, boundedText, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { UUID } from '@/shared/api/platformApiGuards.ts'

const reference = boundedText(WORK_ITEM_REFERENCE, 20)
const title = z.string().min(1).max(200)
/** An agent's reason, summary or a step's text, as it wrote it. */
const written = (max: number) => z.string().min(1).max(max)
const step = written(1000)
/** A day, a time with its zone, or an item's reference, as the agent named it. */
const until = written(64)
/** A session, named as a holder is. */
const session = written(512)
/** A child of a goal or stage that closed without being done, or left it, with its reason. */
const listed = boundedList(strictObject({ reference, reason: written(512).nullable() }), 1000)

/** One key with its values; the outer object is a plain `z.object` so the union can tell keys apart. */
const message = <K extends string, V extends z.ZodRawShape>(key: K, values: V) =>
  z.object({ key: z.literal(key), values: strictObject(values) }).strict()

const confirmation = {
  reference,
  cancelled: listed,
  moved_out: listed,
  steps: boundedList(step, 100),
  hidden: positiveInt(true),
}

/** The prompt of a question the service asked. */
export const promptMessageSchema = z.discriminatedUnion('key', [
  message('task_filed', { reference, goal: reference, title }),
  message('task_moved_in', { reference, goal: reference, title }),
  message('task_moved_to', { reference, goal: reference, state: written(64), title }),
  message('goal_proposed', { reference, title }),
  message('goal_came_back', { reference, title }),
  message('put_off_asked', {
    reference,
    kind: z.enum(['goal', 'stage']),
    title,
    until,
    reason: written(400),
  }),
  message('put_off_came', { reference, until: until.nullable(), item: reference.nullable() }),
  message('cancel_asked', {
    reference,
    point: z.enum(['cancel_outside', 'cancel_shared']),
    title,
    reason: written(8000).nullable(),
    sessions_asked: z.boolean(),
    objections: boundedList(strictObject({ session, reason: written(8000) }), 20),
    unanswered: boundedList(session, 20),
  }),
  message('cancel_consent', { reference, title, reason: written(8000).nullable() }),
  message('confirm_asked', confirmation),
  message('confirm_agent', { ...confirmation, summary: written(1000).nullable() }),
  message('confirm_agent_empty', { ...confirmation, summary: written(1000).nullable() }),
  message('steps_asked', {
    reference,
    kind: z.enum(['goal', 'stage']),
    title,
    removed: boundedList(step, 100),
    rewritten: boundedList(strictObject({ from: step, to: step }), 100),
    reason: written(500),
  }),
  message('group_asked', { count: positiveInt(), title }),
])

/** What the summary of agent decisions says was decided. */
export const whatMessageSchema = z.discriminatedUnion('key', [
  message('accepted', {
    reference,
    under: reference.nullable(),
    label: written(200).nullable(),
  }),
  message('moved', { reference, under: reference }),
  message('cancelled', { reference, question: boundedText(UUID, 36).nullable() }),
  message('closed', { reference }),
  message('put_off', { reference, until, reason: written(400) }),
  message('steps', {
    changes: boundedList(
      strictObject({
        change: z.enum(['removed', 'rewrote', 'clarified']),
        before: step,
        after: step.nullable(),
      }),
      200,
    ),
    reason: written(500).nullable(),
  }),
  message('chose', { labels: boundedList(written(200), 800) }),
  message('group', { title, answer: z.enum(['do', 'later', 'drop']), count: positiveInt() }),
])

export type PromptMessage = z.infer<typeof promptMessageSchema>
export type WhatMessage = z.infer<typeof whatMessageSchema>
