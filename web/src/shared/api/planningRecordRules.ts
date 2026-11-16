/**
 * What a work item record holds to across its fields, and the take-next queue's
 * reasons it carries: the rules a strict reader checks beyond each field's own shape.
 */

import type { z } from '@/shared/api/contract.ts'
import { boundedText, strictObject, uniqueList } from '@/shared/api/contract.ts'
import { enumField, ISO } from '@/shared/api/platformApiGuards.ts'

/**
 * Why the take-next queue does not give an item, in the order a record names them:
 * a goal or stage, not in a ready state, held, waiting on a blocker, an open question
 * to the owner, no way into work from its state, and a goal or stage over it in
 * triage, deferred, waiting or closed.
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
  'ancestor_waits',
  'ancestor_closed',
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
