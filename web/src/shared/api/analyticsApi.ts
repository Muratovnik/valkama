/**
 * What agent work spent in a period: `GET /api/analytics/usage`, read by the Analytics page.
 *
 * The answer is described in `docs/connection-contract.md` ("What agent work spent in a
 * period"). Its figures add up exactly: the rows to the total, the steps of the series to the
 * total, a step's groups to the step. Strict like every contract here: a field nobody declared
 * is refused rather than drawn.
 */

import { boundedText, parseContract, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { TITLE, WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { tokensSchema } from '@/shared/api/planningUsageApi.ts'
import { enumField, invalid } from '@/shared/api/platformApiGuards.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

/**
 * The dimensions the read breaks work down by and filters it on, in the contract's order. The
 * one list of them on the web: the address, the filters and the breakdown all read it here.
 */
export const USAGE_DIMENSIONS = [
  'account',
  'project',
  'work_item',
  'executor',
  'role',
  'launch_class',
  'model',
  'effort',
  'environment',
] as const
export type UsageDimension = (typeof USAGE_DIMENSIONS)[number]

export const isUsageDimension = (value: unknown): value is UsageDimension =>
  USAGE_DIMENSIONS.includes(value as UsageDimension)

const VALUE = /^[^\u{0}]{1,512}$/u
/** A moment with its own offset, as the read writes it: `2030-03-04T00:00:00+03:00`. */
const MOMENT = /^\d{4}-\d{2}-\d{2}T[^\s]{1,80}$/u
const RUN_TEXT = /^[^\u{0}]{1,200}$/u

const seconds = () => z.number().nonnegative()
const moment = () => boundedText(MOMENT, 96)
const onTheSide = () => z.string().max(200)

const measures = {
  agent_seconds: seconds(),
  estimated_seconds: seconds(),
  quality: enumField(['observed', 'estimated', 'mixed'] as const).nullable(),
  tokens: tokensSchema,
  estimated_api_cost_usd: z.number().nonnegative().nullable(),
  /** The tokens of the work with no price: what the cost beside it leaves out. */
  unpriced_tokens: positiveInt(true),
}

/**
 * One value of a dimension. `id` is null for work on no item (`unknown` false) and for a value
 * the store does not hold (`unknown` true); the names beside it are the ones a card shows.
 */
const groupValueSchema = strictObject({
  id: boundedText(VALUE, 512).nullable(),
  unknown: z.boolean(),
  reference: boundedText(WORK_ITEM_REFERENCE, 20).nullable().optional(),
  title: boundedText(TITLE, 200).nullable().optional(),
  name: boundedText(VALUE, 512).nullable().optional(),
  family: onTheSide().optional(),
  opened_in: onTheSide().optional(),
  opened_host: onTheSide().optional(),
})

const groupSchema = z.partialRecord(z.enum(USAGE_DIMENSIONS), groupValueSchema)

const rowSchema = strictObject({ group: groupSchema, ...measures })

const totalSchema = strictObject({
  ...measures,
  unpriced_models: z.array(boundedText(RUN_TEXT, 200)),
})

const usageSchema = strictObject({
  period: strictObject({
    from: moment(),
    to: moment(),
    step: enumField(['day', 'hour'] as const),
    utc_offset: z.number().int().min(-840).max(840),
  }),
  group_by: z.array(z.enum(USAGE_DIMENSIONS)).max(2),
  cost_basis: z.string().min(1).max(512),
  last_event_at: moment().nullable(),
  total: totalSchema,
  rows: z.array(rowSchema),
  series: z.array(
    strictObject({ start: moment(), end: moment(), ...measures, groups: z.array(rowSchema) }),
  ),
  comparison: strictObject({
    period: strictObject({ from: moment(), to: moment() }),
    total: totalSchema,
    rows: z.array(rowSchema),
  }).nullable(),
})

const answerSchema = strictObject({
  interface_version: z.literal('valkama-analytics-api', {
    message: 'expected valkama-analytics-api',
  }),
  usage: usageSchema,
})

export type Usage = z.infer<typeof usageSchema>
export type UsageRow = Usage['rows'][number]
export type UsageMeasures = Omit<UsageRow, 'group'>
export type UsageGroupValue = z.infer<typeof groupValueSchema>

/** A dimension's admitted values; `null` admits work with no value there ("none"). */
export type UsageFilters = Partial<Record<UsageDimension, readonly (string | null)[]>>

export interface UsageQuery {
  compare: boolean
  filters: UsageFilters
  /** A date, the start of that day at `utcOffset`, or a time with its own offset. */
  from: string
  groupBy: readonly UsageDimension[]
  /** Not included; a date or a time, as `from`. */
  to: string
  utcOffset: number
}

/** The query string of a read: each filter by its dimension's name, and `none` for the rest. */
export function usageParameters(query: UsageQuery): URLSearchParams {
  const parameters = new URLSearchParams({
    from: query.from,
    to: query.to,
    step: 'day',
    utc_offset: String(query.utcOffset),
  })
  if (query.groupBy.length) parameters.set('group_by', query.groupBy.join(','))
  const none: UsageDimension[] = []
  for (const dimension of USAGE_DIMENSIONS) {
    const admitted = query.filters[dimension] ?? []
    const values = admitted.filter((value) => value !== null)
    if (values.length) parameters.set(dimension, values.join(','))
    if (admitted.includes(null)) none.push(dimension)
  }
  if (none.length) parameters.set('none', none.join(','))
  if (query.compare) parameters.set('compare', 'true')
  return parameters
}

/** The usage answer, or a refusal naming what does not fit the contract. */
export function validateUsageAnswer(payload: unknown): Usage {
  return parseContract(answerSchema, payload, 'analytics.usage', invalid).usage
}

export async function fetchUsage(query: UsageQuery, signal?: AbortSignal): Promise<Usage> {
  const path = '/api/analytics/usage'
  const { response, payload } = await readJsonResponse(`${path}?${usageParameters(query)}`, {
    signal,
  })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return validateUsageAnswer(payload)
}
