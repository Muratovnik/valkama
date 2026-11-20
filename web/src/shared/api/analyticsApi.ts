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

import { accountIdIssue, WEEKLY_RESET } from '@/shared/api/accountIds.ts'
import { boundedText, parseContract, positiveInt, strictObject, z } from '@/shared/api/contract.ts'
import { TITLE, WORK_ITEM_REFERENCE } from '@/shared/api/planningModel.ts'
import { tokensSchema } from '@/shared/api/planningUsageApi.ts'
import { enumField, invalid } from '@/shared/api/platformApiGuards.ts'
import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

/**
 * The dimensions the page breaks work down by and filters it on: `seat`, the quota account a
 * stretch was spent on, which the page calls the account, then the contract's order, where
 * `account` is the organization the stretch was billed to. The one list of them on the web: the
 * address, the filters and the breakdown all read it here.
 */
export const USAGE_DIMENSIONS = [
  'seat',
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
/**
 * The answer's own moment, once it names an instant, as UTC with a `Z`: the one grammar the page
 * state checks (`platformUiState`). The same instant, but no longer at the answer's offset, so a
 * reader that says a time at the offset of this moment or dates one against its day takes the
 * answer's `utc_offset` back first (`QuotaPanel`).
 */
const utcMoment = () =>
  moment().transform((value, context) => {
    const at = Date.parse(value)
    if (Number.isNaN(at)) {
      context.addIssue({ code: 'custom', message: 'expected a moment' })
      return z.NEVER
    }
    return new Date(at).toISOString()
  })
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

/** A project of a combination: its id and the registry's name, null when it records none now. */
const combinedProjectSchema = strictObject({
  id: boundedText(VALUE, 512),
  name: boundedText(VALUE, 512).nullable(),
})

/**
 * One value of a dimension. `id` is null for work on no item, on an item naming no project or
 * several (`unknown` false) and for a value the store does not hold (`unknown` true); the names
 * beside it are the ones a card shows.
 */
const groupValueSchema = strictObject({
  id: boundedText(VALUE, 512).nullable(),
  unknown: z.boolean(),
  reference: boundedText(WORK_ITEM_REFERENCE, 20).nullable().optional(),
  title: boundedText(TITLE, 200).nullable().optional(),
  name: boundedText(VALUE, 512).nullable().optional(),
  /** A project's: on the group of items naming several, each set of projects they name. */
  combinations: z.array(z.array(combinedProjectSchema).min(2).max(20)).nullable().optional(),
  family: onTheSide().optional(),
  opened_in: onTheSide().optional(),
  opened_host: onTheSide().optional(),
  /**
   * A seat's: its organization, its account's UUID, the time of week its week resets, and whether
   * two accounts' readings may run under it (`accountIds.ts`).
   */
  organization: boundedText(VALUE, 512).nullable().optional(),
  account_uuid: boundedText(VALUE, 512).nullable().optional(),
  weekly_reset: boundedText(WEEKLY_RESET, 8).nullable().optional(),
  shared: z.boolean().optional(),
})

const groupSchema = z
  .partialRecord(z.enum(USAGE_DIMENSIONS), groupValueSchema)
  .superRefine((group, context) => {
    const seat = group.seat
    const issue = seat?.id ? accountIdIssue(seat.id, seat) : null
    if (issue) context.addIssue({ code: 'custom', path: ['seat', 'id'], message: issue })
  })

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

/** The page's dimension an answer is broken down by first; `null` with none or one it does not offer. */
export const pageDimensionOf = (usage: Usage): UsageDimension | null => {
  const first = usage.group_by[0]
  return isUsageDimension(first) ? first : null
}

/** A dimension's admitted values; `null` admits work with no value there ("none"). */
export type UsageFilters = Partial<Record<UsageDimension, readonly (string | null)[]>>

export interface UsageQuery {
  compare: boolean
  /** The page's filters, and for the quota panel a `seat`'s. */
  filters: Partial<Record<UsageDimension, readonly (string | null)[]>>
  /** A date, the start of that day at `utcOffset`, or a time with its own offset. */
  from: string
  groupBy: readonly UsageDimension[]
  /** Not included; a date or a time, as `from`. */
  to: string
  utcOffset: number
  /** The space the read is narrowed to, by its key: the work its board holds. None at the top. */
  space?: string | null
  /** How the series is cut: by day, the default, by hour or by minute. */
  step?: UsageStep
}

/**
 * The query string of a read: each filter by its dimension's name, `none` for the rest, and the
 * space it is narrowed to.
 */
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
  if (query.space) parameters.set('space', query.space)
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

/** A share of a window, from 0; above 100 only where the source said it overran. */
const percent = () => z.number().nonnegative()
const quotaState = () => enumField(['fresh', 'silent'] as const)
const quotaSource = () => enumField(QUOTA_SOURCES)

const quotaReadingSchema = strictObject({
  at: moment(),
  used_percent: percent(),
  source: quotaSource(),
})

/**
 * The five hours' point answer: it lasts to the reset with the share it has spent by then, runs
 * out at a time, or is spent.
 */
const pointForecastSchema = strictObject({
  outcome: enumField(['lasts', 'runs_out', 'spent'] as const),
  runs_out_at: moment().nullable(),
  at_reset_percent: percent().max(100).nullable(),
  basis: enumField(['recent', 'blend', 'window'] as const).nullable(),
})
  .refine((point) => (point.outcome === 'runs_out') === (point.runs_out_at !== null), {
    message: 'a time to run out at only where it runs out',
  })
  .refine((point) => (point.outcome === 'lasts') === (point.at_reset_percent !== null), {
    message: 'a share at the reset only where it lasts',
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
  /**
   * Where the window's count restarted inside it, its reset unchanged: the moment of the reading
   * whose feed fell from its own previous reading, oldest first. The readings keep the fall.
   */
  restarts: z.array(moment()),
  forecast: z.union([pointForecastSchema, rangeForecastSchema]).nullable(),
}).superRefine((window, context) => {
  if ((window.kind === 'week_model') !== (window.model !== null))
    context.addIssue({ code: 'custom', path: ['model'], message: 'a model only for its week' })
  const read = new Set(window.readings.map((reading) => reading.at))
  for (const [index, at] of window.restarts.entries())
    if (!read.has(at))
      context.addIssue({
        code: 'custom',
        path: ['restarts', index],
        message: 'a restart is the moment of one of the readings',
      })
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
  /** The account's id, as the `seat` dimension gives it (`accountIds.ts`). */
  account: boundedText(VALUE, 512),
  organization: boundedText(VALUE, 512),
  account_uuid: boundedText(VALUE, 512).nullable(),
  weekly_reset: boundedText(WEEKLY_RESET, 8).nullable(),
  /** Two accounts' readings may run under this weekly-reset account. */
  shared: z.boolean(),
  plan: boundedText(RUN_TEXT, 200).nullable(),
  /** The owner's name for the account itself, and for its organization. */
  name: boundedText(VALUE, 512).nullable(),
  organization_name: boundedText(VALUE, 512).nullable(),
  no_source: z.boolean(),
  windows: z.array(z.union([shareWindowSchema, spendWindowSchema])),
}).superRefine((account, context) => {
  if (account.no_source && account.windows.length)
    context.addIssue({ code: 'custom', path: ['windows'], message: 'no source reads no window' })
  const issue = accountIdIssue(account.account, account)
  if (issue) context.addIssue({ code: 'custom', path: ['account'], message: issue })
})

const quotaSchema = strictObject({
  /** When the answer was read: UTC with a `Z`, unlike the offset every other moment carries. */
  now: utcMoment(),
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
/** A week's forecast: the share its slower and its faster pace spend by the reset. */
export type QuotaRange = Extract<NonNullable<QuotaShareWindow['forecast']>, { low_percent: number }>

/** Whether a window is a share of a limit, with a percent, a pace and readings. */
export const isShareWindow = (window: QuotaWindow): window is QuotaShareWindow =>
  'readings' in window

/** The quota answer, or a refusal naming what does not fit the contract. */
export function validateQuotaAnswer(payload: unknown): Quota {
  return parseContract(quotaAnswerSchema, payload, 'analytics.quota', invalid).quota
}

/** Each account's quota now, every time in it at `utcOffset` minutes east of UTC, but `now` in UTC. */
export async function fetchQuota(utcOffset: number, signal?: AbortSignal): Promise<Quota> {
  const path = '/api/analytics/quota'
  const query = new URLSearchParams({ utc_offset: String(utcOffset) })
  const { response, payload } = await readJsonResponse(`${path}?${query}`, { signal })
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`)
  return validateQuotaAnswer(payload)
}
