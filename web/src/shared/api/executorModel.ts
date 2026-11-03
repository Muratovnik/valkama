/**
 * Who stands behind a claim, a step or an agent, and what opening them would
 * reach: only the card's read carries it. `session` is the session a click opens,
 * an agent's parent for an agent. `none` is a holder with no session to open, a
 * person's or one a label cannot name, and leaves every other field empty.
 */

import { boundedText, strictObject } from '@/shared/api/contract.ts'
import type { z } from '@/shared/api/contract.ts'
import { OPENED_HOSTS, OPENED_IN, PLAN_STATES } from '@/shared/api/openPlanModel.ts'
import { enumField } from '@/shared/api/platformApiGuards.ts'

const callId = () => boundedText(/^[^\u{0}]{1,200}$/u, 200).nullable()

export const executorSchema = strictObject({
  session: callId(),
  agent: callId(),
  opened_in: enumField(OPENED_IN),
  opened_host: enumField(OPENED_HOSTS),
  /** Whose settings cover the session; empty for `none`. */
  family: enumField(['', 'claude', 'codex', 'other'] as const),
  state: enumField(PLAN_STATES),
})

export type Executor = z.infer<typeof executorSchema>
