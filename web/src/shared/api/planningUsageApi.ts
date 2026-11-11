/**
 * How much work an item or a session took: time, tokens and what they would cost.
 *
 * The card's record carries none of this, so it is a read of its own. It answers
 * under `/api/planning/`, as the chain does, and for the primary store alone: that
 * prefix takes no data scope and refuses one that is named, so a caller asks it
 * nothing for an item of an attached store. Strict like every planning contract:
 * a field nobody declared is refused rather than drawn.
 */

import { boundedText, parseContract, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { TITLE, WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { enumField, invalid, ISO, UUID } from '@/shared/api/platformApiGuards.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

const SCOPES = ['item', 'chain', 'epic'] as const
export type UsageScope = (typeof SCOPES)[number]

const RUN_TEXT = /^[^\u{0}]{1,200}$/u

const seconds = () => z.number().nonnegative()
const moment = () => boundedText(ISO, 96).nullable()
const runText = () => boundedText(RUN_TEXT, 200)
/** A kind no request reported is null, and null is no data: never a zero. */
const tokenCount = () => positiveInt(true).nullable()

/** Tokens by kind, as every usage read gives them; the analytics read too. */
export const tokensSchema = strictObject({
  input: tokenCount(),
  cached_read: tokenCount(),
  cache_write_5m: tokenCount(),
  cache_write_1h: tokenCount(),
  output: tokenCount(),
  reasoning: tokenCount(),
})

const spent = {
  tokens: tokensSchema,
  estimated_api_cost_usd: z.number().nonnegative().nullable(),
  /** The tokens of the rows with no cost: what the cost beside it leaves out. */
  unpriced_tokens: positiveInt(true),
}

const lineSchema = strictObject({
  /** Null only on a session's line of what no item took. */
  work_item_id: boundedText(UUID, 36).nullable(),
  /** Null with the title for an item since deleted, and on that same line. */
  reference: boundedText(WORK_ITEM_REFERENCE, 20).nullable(),
  title: boundedText(TITLE, 200).nullable(),
  elapsed_seconds: seconds(),
  agent_seconds: seconds(),
  ...spent,
})

const summary = {
  elapsed_seconds: seconds(),
  agent_seconds: seconds(),
  ...spent,
  cost_basis: z.string().min(1).max(512),
  unpriced_models: z.array(runText()),
  agents: z.array(
    strictObject({
      session_id: runText(),
      /** Null for the session's own run. */
      agent_id: runText().nullable(),
      seconds: seconds(),
      ...spent,
    }),
  ),
  models: z.array(strictObject({ model: runText().nullable(), seconds: seconds(), ...spent })),
  signals: z.array(
    strictObject({ signal: runText().nullable(), seconds: seconds(), share: z.number() }),
  ),
  quality: enumField(['observed', 'estimated', 'mixed'] as const).nullable(),
  estimated_seconds: seconds(),
  by_item: z.array(lineSchema),
}

const excludedSchema = strictObject({
  human: seconds(),
  subagent: seconds(),
  external: seconds(),
  gap: seconds(),
})

/**
 * A value of what the work ran under. `unknown` is the store not holding it; an `id` of null
 * that is not unknown is none by its nature, such as the class of a session's own agent.
 */
const valueSchema = strictObject({ id: runText().nullable(), unknown: z.boolean() })

const ROLES = ['main', 'subagent', 'advisor'] as const

/** The parts below add up to the item's whole exactly, in milliseconds and millionths of a dollar. */
const part = { seconds: seconds(), ...spent }

const itemUsageSchema = strictObject({
  work_item_id: boundedText(UUID, 36),
  reference: boundedText(WORK_ITEM_REFERENCE, 20),
  title: boundedText(TITLE, 200),
  scope: enumField(SCOPES),
  ...summary,
  /**
   * In time order; two neighbours never share an account. A change of account is a line under a
   * known account after one under a different known account, with or without lines under an
   * unknown one between them; a line under an unknown account is never a change.
   */
  account_stretches: z.array(
    strictObject({
      account: valueSchema,
      started_at: boundedText(ISO, 96),
      ended_at: boundedText(ISO, 96),
      ...part,
    }),
  ),
  /** Each account, the most time first, with its share of the agents' time. */
  accounts: z.array(strictObject({ account: valueSchema, share: z.number(), ...part })),
  /** Who did the work, with the class it was launched with and its effort, ranked. */
  roles: z.array(
    strictObject({
      role: enumField(ROLES),
      launch_class: valueSchema,
      effort: valueSchema,
      ...part,
    }),
  ),
})

const sessionUsageSchema = strictObject({
  session_id: runText(),
  first_at: moment(),
  last_at: moment(),
  ...summary,
  excluded: excludedSchema,
  runs: z.array(
    strictObject({
      agent_id: runText().nullable(),
      client: runText(),
      status: runText(),
      first_at: moment(),
      last_at: moment(),
      read_at: moment(),
      excluded: excludedSchema,
    }),
  ),
})

const answer = <T extends z.ZodType>(usage: T) =>
  strictObject({
    interface_version: z.literal('valkama-planning-api', {
      message: 'expected valkama-planning-api',
    }),
    usage,
  })

const itemAnswer = answer(itemUsageSchema)
const sessionAnswer = answer(sessionUsageSchema)

export type ItemUsage = z.infer<typeof itemUsageSchema>
export type SessionUsage = z.infer<typeof sessionUsageSchema>
export type UsageTokens = ItemUsage['tokens']
export type UsageAgent = ItemUsage['agents'][number]
export type UsageLine = ItemUsage['by_item'][number]
export type UsageRole = ItemUsage['roles'][number]

async function readUsage(path: string, parameters: URLSearchParams, signal?: AbortSignal) {
  const { response, payload } = await readJsonResponse(`${path}?${parameters}`, { signal })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return payload
}

/** An item's usage answer, or a refusal naming what does not fit the contract. */
export function validateItemUsageAnswer(payload: unknown): ItemUsage {
  return parseContract(itemAnswer, payload, 'planning.usage', invalid).usage
}

/** A session's usage answer, or a refusal naming what does not fit the contract. */
export function validateSessionUsageAnswer(payload: unknown): SessionUsage {
  return parseContract(sessionAnswer, payload, 'planning.sessionUsage', invalid).usage
}

export async function fetchItemUsage(
  id: string,
  scope: UsageScope,
  signal?: AbortSignal,
): Promise<ItemUsage> {
  const payload = await readUsage(
    '/api/planning/work-item/usage',
    new URLSearchParams({ id, scope }),
    signal,
  )
  return validateItemUsageAnswer(payload)
}

export async function fetchSessionUsage(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionUsage> {
  const payload = await readUsage(
    '/api/planning/session/usage',
    new URLSearchParams({ session_id: sessionId }),
    signal,
  )
  return validateSessionUsageAnswer(payload)
}
