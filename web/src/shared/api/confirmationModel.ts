/**
 * What the confirmer of a goal or stage checks while it awaits confirmation.
 *
 * The record carries it only then: nothing is open under the container any more,
 * and completing it is the confirmation.
 */

import { boundedText, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { serverText } from '@/shared/api/planningText.ts'
import { ISO, UUID } from '@/shared/api/platformApiGuards.ts'

/** A child that closed without being done, or that left: null when it gave no reason. */
const closedChildSchema = strictObject({
  reference: boundedText(/^[A-Z][A-Z0-9]{1,7}-[1-9]\d{0,8}$/u, 20),
  reason: serverText().nullable(),
})

export const confirmationSchema = strictObject({
  /** Null only on a store whose wait was never recorded. */
  since: boundedText(ISO, 96).nullable(),
  /** How many steps the container has: 0 means it is checked against its description. */
  steps: positiveInt(true),
  // As many as the container had children: the server sends each one.
  cancelled: z.array(closedChildSchema),
  moved_out: z.array(closedChildSchema),
  /** The confirmation question once one is asked. */
  asked: boundedText(UUID, 36).nullable(),
  /** When the question was left for the next session of the one who asked. */
  left_for_next_session: boundedText(ISO, 96).nullable(),
})
