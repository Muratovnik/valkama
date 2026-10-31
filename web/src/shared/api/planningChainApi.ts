/**
 * One chain of work: an item's children and everything discovered from them.
 *
 * The read model answers what is in a space; this answers what one piece of work
 * grew into, which no projection of the space can say without walking every
 * discovery edge itself. The server walks them once and sends the members, the
 * edges between them and the scope's history, so the card and the graph read the
 * same answer rather than each reconstructing a different chain.
 *
 * Strict like every planning contract: an unknown field is refused, every list
 * is bounded, and the counts must agree with the members they summarise, because
 * a headline that disagrees with the rows under it is worse than an error.
 */

import {
  boundedList,
  boundedText,
  parseContract,
  positiveInt,
  strictObject,
  z,
} from '@/shared/api/contract.ts'
import {
  blankable,
  CLAIM_STATES,
  readRefusal,
  STATE_CATEGORIES,
  STATE_KEY,
  TITLE,
  WORK_ITEM_KINDS,
  WORK_ITEM_REFERENCE,
} from '@/shared/api/planningModel.ts'
import { enumField, invalid, ISO, UUID } from '@/shared/api/platformApiGuards.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

const CHAIN_SCOPES = ['chain', 'epic'] as const
export type ChainScope = (typeof CHAIN_SCOPES)[number]

const count = () => positiveInt(true)
const reference = () => boundedText(WORK_ITEM_REFERENCE, 20)
const title = () => boundedText(TITLE, 200)
const DAY = /^\d{4}-\d{2}-\d{2}$/u

const rootSchema = strictObject({
  work_item_id: boundedText(UUID, 36),
  reference: reference(),
  title: title(),
  kind: enumField(WORK_ITEM_KINDS),
  has_children: z.boolean(),
})

const originSchema = strictObject({
  parent_reference: reference().nullable(),
  parent_title: title().nullable(),
  count: count(),
  open: count(),
})

const daySchema = strictObject({
  day: boundedText(DAY, 10),
  created: count(),
  closed: count(),
  total: count(),
  closed_total: count(),
})

const memberSchema = strictObject({
  work_item_id: boundedText(UUID, 36),
  reference: reference(),
  title: title(),
  state: strictObject({
    key: boundedText(STATE_KEY, 32),
    name: title(),
    category: enumField(STATE_CATEGORIES),
    is_terminal: z.boolean(),
  }),
  claim_ref: blankable(128),
  claim_state: enumField(CLAIM_STATES).nullable(),
  parent_reference: reference().nullable(),
  created_at: boundedText(ISO, 96),
  closed_at: boundedText(ISO, 96).nullable(),
  ready: z.boolean(),
})

const chainSchema = strictObject({
  root: rootSchema,
  scope: enumField(CHAIN_SCOPES),
  total: count(),
  closed: count(),
  open: count(),
  ready: count(),
  by_category: z.partialRecord(enumField(STATE_CATEGORIES), count()),
  origins: boundedList(originSchema, 500),
  series: boundedList(daySchema, 4000).refine(
    (days) => days.every((entry, index) => index === 0 || days[index - 1].day < entry.day),
    { message: 'expected ascending days' },
  ),
  recent: strictObject({
    days: positiveInt(),
    created: count(),
    closed: count(),
    trend: enumField(['growing', 'converging', 'steady'] as const),
  }),
  members: boundedList(memberSchema, 5000),
  edges: boundedList(
    strictObject({
      from: boundedText(UUID, 36),
      to: boundedText(UUID, 36),
      kind: enumField(['blocks', 'discovered-from'] as const),
    }),
    20_000,
  ),
})
  .refine((chain) => chain.open + chain.closed === chain.total, {
    message: 'open and closed add up to the total',
  })
  .refine((chain) => chain.members.length === chain.total, {
    message: 'every member is counted once',
  })

/** Every planning read names its interface beside the payload. */
const responseSchema = strictObject({
  interface_version: z.literal('valkama-planning-api', {
    message: 'expected valkama-planning-api',
  }),
  chain: chainSchema,
})

export type WorkItemChain = z.infer<typeof chainSchema>
export type ChainMember = WorkItemChain['members'][number]
export type ChainDay = WorkItemChain['series'][number]

function validateWorkItemChain(value: unknown, path = 'planning.chain'): WorkItemChain {
  return parseContract(responseSchema, value, path, invalid).chain
}

/** The server said no, with its own code and the HTTP status it answered with. */
class ChainRequestError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ChainRequestError'
    this.code = code
    this.status = status
  }
}

export async function fetchWorkItemChain(
  id: string,
  scope: ChainScope,
  signal?: AbortSignal,
): Promise<WorkItemChain> {
  const parameters = new URLSearchParams({ id, scope })
  const { response, payload } = await readJsonResponse(
    `/api/planning/work-item/chain?${parameters}`,
    { signal },
  )
  if (!response.ok) {
    const refusal = readRefusal(payload)
    throw new ChainRequestError(
      refusal?.error.code ?? 'request_failed',
      refusal?.error.message ?? `HTTP ${response.status}`,
      response.status,
    )
  }
  return validateWorkItemChain(payload)
}
