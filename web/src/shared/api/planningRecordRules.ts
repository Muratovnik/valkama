/**
 * What a work item record holds to across its fields, and the take-next queue's
 * reasons, lapsed claim and put-off condition it carries: the rules a strict reader checks
 * beyond each field's own shape.
 */

import {
  blankable,
  boundedText,
  positiveInt,
  strictObject,
  uniqueList,
  z,
} from '@/shared/api/contract.ts'
import { enumField, ISO } from '@/shared/api/platformApiGuards.ts'

/**
 * Why the take-next queue does not give an item, in the order a record names them:
 * a goal or stage, not in a ready state, held, waiting on a blocker, an open question
 * to the owner, no way into work from its state, a goal or stage over it in
 * triage, deferred, waiting to be cancelled, waiting or closed, and, in a read of one
 * space, an item of another space that the read holds for a project it names.
 */
const WITHHELD_CODES = [
  'goal_or_stage',
  'not_ready',
  'held',
  'waits',
  'question',
  'no_start',
  'ancestor_triage',
  'ancestor_deferred',
  'ancestor_cancelling',
  'ancestor_waits',
  'ancestor_closed',
  'outside_space',
] as const

/** Why the queue does not give it, each reason once, in the server's one order. */
export const withheldField = () => uniqueList(enumField(WITHHELD_CODES), WITHHELD_CODES.length)

/** Why a lease lapsed: its session ended, has no row, or went quiet. */
const LAPSE_REASONS = ['session-ended', 'session-missing', 'lease-expired'] as const

/**
 * Whose claim the lease sweep released, why and when; null while nothing lapsed, from
 * the next claim on, while somebody holds the item and once it is closed.
 */
export const lapsedClaimField = () =>
  strictObject({
    holder: boundedText(/^[^\u{0}]{1,128}$/u, 128),
    reason: enumField(LAPSE_REASONS),
    at: boundedText(ISO, 96),
  }).nullable()

const REFERENCE = () => boundedText(/^[A-Z][A-Z0-9]{1,7}-[1-9]\d{0,8}$/u, 20)

/**
 * The condition of an item put off, only while it stands in a deferred state: the moment
 * or the item it waits on, one of the two; why, since when and who put it off; and when
 * the condition came while the owner is asked whether to take it up again.
 */
export const deferredField = () =>
  strictObject({
    until: boundedText(ISO, 96).nullable(),
    until_item: REFERENCE().nullable(),
    reason: blankable(400),
    since: boundedText(ISO, 96),
    by: strictObject({ author: blankable(128).nullable(), session_id: blankable(200).nullable() }),
    reached_at: boundedText(ISO, 96).nullable(),
  }).refine((found) => (found.until === null) !== (found.until_item === null), {
    message: 'expected a moment or an item to wait on',
  })

/** Why an item in triage came back from being put off: the day, or what became of the item. */
const RETURN_CAUSES = ['date', 'completed', 'cancelled', 'deleted'] as const

/** Why and when an item came back, only while its newest move is the return. */
export const returnedField = () =>
  strictObject({
    because: enumField(RETURN_CAUSES),
    item: REFERENCE().nullable(),
    at: boundedText(ISO, 96),
  })

/**
 * What became of steps no longer on the item as they were, only when its history says so:
 * the texts taken off or reworded, each cut to 120 characters, and the items that took
 * steps away with their work. The history keeps them all, so neither list is bounded.
 */
export const conditionsChangedField = () =>
  strictObject({
    removed: z.array(blankable(120)),
    moved: z.array(strictObject({ to: REFERENCE(), count: positiveInt(true) })),
  })

/**
 * A work item record, strict: it stands in a state or derives one as an accepted open
 * container, one of the two, and it is `workable` exactly when nothing is withheld.
 */
export function recordObject<T extends z.ZodRawShape>(shape: T) {
  return strictObject(shape)
    .refine(
      (item: { container_state?: unknown; state?: unknown }) =>
        (item.state === null) !== (item.container_state === null),
      { message: 'expected a state or a container state' },
    )
    .refine(
      (item: { withheld?: readonly string[]; workable?: boolean }) =>
        item.workable === (item.withheld?.length === 0),
      { message: 'expected workable exactly when nothing is withheld' },
    )
}
