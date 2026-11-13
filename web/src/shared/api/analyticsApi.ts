/**
 * What agent work spent in a period, `GET /api/analytics/usage`, and where each account's
 * subscription quota stands now, `GET /api/analytics/quota`: the two reads of the Analytics page.
 *
 * Both answers are described in `docs/connection-contract.md` ("What agent work spent in a
 * period", "Each account's subscription quota"). The usage figures add up exactly: the rows to
 * the total, the steps of the series to the total, a step's groups to the step. A quota figure
 * is a share of one window of one account and adds up to nothing. Strict like every contract
 * here: a field nobody declared is refused rather than drawn.
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

/** How a period's series is cut: by the minute, by the hour, or by the day, the default. */
const USAGE_STEPS = ['minute', 'hour', 'day'] as const
export type UsageStep = (typeof USAGE_STEPS)[number]

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
    step: enumField(USAGE_STEPS),
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
  /** How the series is cut: by day, the default, by hour or by minute. */
  step?: UsageStep
}

/** The query string of a read: each filter by its dimension's name, and `none` for the rest. */
export function usageParameters(query: UsageQuery): URLSearchParams {
  const parameters = new URLSearchParams({
    from: query.from,
    to: query.to,
    step: query.step ?? 'day',
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

/** Who read a quota window: the status line, the mod, the poll of the usage endpoint, an import. */
const QUOTA_SOURCES = ['statusline', 'mod', 'poll', 'import'] as const

/** The windows that are a share of a limit, in the answer's order. */
const SHARE_KINDS = ['five_hour', 'week', 'week_model'] as const
/** The windows of money spent past a limit, which the answer gives no figure of. */
const SPEND_KINDS = ['extra_usage', 'spend_limit'] as const

/** A provisional seat: `week:` and its week's reset to the ten minutes. */
const SEAT = /^week:\d{4}-\d{2}-\d{2}T\d{2}:\d0Z$/u

/** A share of a window, from 0; above 100 only where the source said it overran. */
const percent = () => z.number().nonnegative()
const quotaState = () => enumField(['fresh', 'silent'] as const)
const quotaSource = () => enumField(QUOTA_SOURCES)

const quotaReadingSchema = strictObject({
  at: moment(),
  used_percent: percent(),
  source: quotaSource(),
})

/** The five hours' point answer: it lasts to the reset, runs out at a time, or is spent. */
const pointForecastSchema = strictObject({
  outcome: enumField(['lasts', 'runs_out', 'spent'] as const),
  runs_out_at: moment().nullable(),
  basis: enumField(['recent', 'blend', 'window'] as const).nullable(),
}).refine((point) => (point.outcome === 'runs_out') === (point.runs_out_at !== null), {
  message: 'a time to run out at only where it runs out',
})

/** A week's answer, only ever a range: what its slower and its faster pace spend by the reset. */
const rangeForecastSchema = strictObject({
  low_percent: percent(),
  high_percent: percent(),
}).refine((range) => range.low_percent <= range.high_percent, {
  message: 'a range runs from its low to its high',
})

const shareWindowSchema = strictObject({
  kind: enumField(SHARE_KINDS),
  model: boundedText(RUN_TEXT, 200).nullable(),
  state: quotaState(),
  resets_at: moment().nullable(),
  latest: quotaReadingSchema,
  started_at: moment().nullable(),
  even_percent: percent().nullable(),
  readings: z.array(quotaReadingSchema),
  forecast: z.union([pointForecastSchema, rangeForecastSchema]).nullable(),
}).superRefine((window, context) => {
  if ((window.kind === 'week_model') !== (window.model !== null))
    context.addIssue({ code: 'custom', path: ['model'], message: 'a model only for its week' })
  const { forecast } = window
  if (forecast && 'outcome' in forecast !== (window.kind === 'five_hour'))
    context.addIssue({
      code: 'custom',
      path: ['forecast'],
      message: 'a point for the five hours, a range for a week',
    })
})

const spendWindowSchema = strictObject({
  kind: enumField(SPEND_KINDS),
  model: z.null(),
  state: quotaState(),
  resets_at: moment().nullable(),
  latest: strictObject({ at: moment(), source: quotaSource() }),
})

const quotaAccountSchema = strictObject({
  organization: boundedText(VALUE, 512),
  account_uuid: boundedText(VALUE, 512).nullable(),
  seat: boundedText(SEAT, 32).nullable(),
  plan: boundedText(RUN_TEXT, 200).nullable(),
  name: boundedText(VALUE, 512).nullable(),
  no_source: z.boolean(),
  windows: z.array(z.union([shareWindowSchema, spendWindowSchema])),
}).superRefine((account, context) => {
  if (account.no_source && account.windows.length)
    context.addIssue({ code: 'custom', path: ['windows'], message: 'no source reads no window' })
  if (account.account_uuid !== null && account.seat !== null)
    context.addIssue({ code: 'custom', path: ['seat'], message: 'a seat only without an account' })
})

const quotaSchema = strictObject({
  now: moment(),
  utc_offset: z.number().int().min(-840).max(840),
  fresh_for_seconds: positiveInt(),
  accounts: z.array(quotaAccountSchema),
})

const quotaAnswerSchema = strictObject({
  interface_version: z.literal('valkama-analytics-api', {
    message: 'expected valkama-analytics-api',
  }),
  quota: quotaSchema,
})

export type Quota = z.infer<typeof quotaSchema>
export type QuotaAccount = Quota['accounts'][number]
export type QuotaWindow = QuotaAccount['windows'][number]
/** A window that is a share of a limit: five hours, the week, a model's week. */
export type QuotaShareWindow = Extract<QuotaWindow, { readings: unknown }>

/** Whether a window is a share of a limit, with a percent, a pace and readings. */
export const isShareWindow = (window: QuotaWindow): window is QuotaShareWindow =>
  'readings' in window

/** The quota answer, or a refusal naming what does not fit the contract. */
export function validateQuotaAnswer(payload: unknown): Quota {
  return parseContract(quotaAnswerSchema, payload, 'analytics.quota', invalid).quota
}

/** Each account's quota now, every time in it at `utcOffset` minutes east of UTC. */
export async function fetchQuota(utcOffset: number, signal?: AbortSignal): Promise<Quota> {
  const path = '/api/analytics/quota'
  const query = new URLSearchParams({ utc_offset: String(utcOffset) })
  const { response, payload } = await readJsonResponse(`${path}?${query}`, { signal })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return validateQuotaAnswer(payload)
}
