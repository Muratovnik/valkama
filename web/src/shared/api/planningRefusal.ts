/**
 * What a Planning boundary answers when it does not answer with what was asked: a
 * refusal, the shape every neutral write says no with, or the typed unavailable a
 * read answers with while the cutover is pending.
 */

import { boundedText, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { serverText } from '@/shared/api/planningText.ts'

const PLANNING_API = 'valkama-planning-api' as const

const apiVersion = z.literal(PLANNING_API, { message: `expected ${PLANNING_API}` })

/**
 * The step of a batch a refusal stands on: a write of several groups in one call
 * (`/api/planning/work-item/apply`, a creation with its claim, steps and links) names the
 * group and the entry's position in it beside the code and the message, whatever refused it.
 */
export const refusedStep = strictObject({
  group: boundedText(/^[a-z_]{1,64}$/u, 64),
  index: positiveInt(true),
}).optional()

/** The refusal shape every neutral write answers with when it says no. */
const refusalSchema = strictObject({
  error: strictObject({
    code: boundedText(/^[a-z_]{1,64}$/u, 64),
    message: serverText(),
    expected: positiveInt(true).optional(),
    actual: positiveInt(true).optional(),
    step: refusedStep,
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

type PlanningRefusal = z.infer<typeof refusalSchema>
type PlanningPending = z.infer<typeof pendingSchema>

export function readRefusal(value: unknown): PlanningRefusal | null {
  const parsed = refusalSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export function readPending(value: unknown): PlanningPending | null {
  const parsed = pendingSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}
