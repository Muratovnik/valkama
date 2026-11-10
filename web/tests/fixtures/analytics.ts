/**
 * What the Analytics read answers, built from stretches of work so that its figures add up the
 * way the contract says: the rows to the total, the days to the total, a day's groups to the
 * day. Every id, name and number is made up.
 *
 * `role` is a dimension the read is gaining; until the server answers by it, it is here.
 */
import type {
  Usage,
  UsageDimension,
  UsageGroupValue,
  UsageMeasures,
  UsageRow,
} from '@/shared/api/analyticsApi.ts'

const COST_BASIS =
  'An estimate at public API list prices for each request. A subscription pays differently, so this is not a bill.'

/** What one stretch spent: seconds, tokens processed anew, a price and the tokens without one. */
interface Spend {
  cost?: number | null
  seconds?: number
  tokens?: number | null
  unpriced?: number
}

function measures({ seconds = 0, tokens = null, cost = null, unpriced = 0 }: Spend): UsageMeasures {
  return {
    agent_seconds: seconds,
    estimated_seconds: 0,
    quality: seconds > 0 ? 'observed' : null,
    tokens: {
      input: tokens,
      cached_read: null,
      cache_write_5m: null,
      cache_write_1h: null,
      output: null,
      reasoning: null,
    },
    estimated_api_cost_usd: cost,
    unpriced_tokens: unpriced,
  }
}

const plus = (left: number | null, right: number | null) =>
  left === null && right === null ? null : (left ?? 0) + (right ?? 0)

function add(left: UsageMeasures, right: UsageMeasures): UsageMeasures {
  return measures({
    seconds: left.agent_seconds + right.agent_seconds,
    tokens: plus(left.tokens.input, right.tokens.input),
    cost: plus(left.estimated_api_cost_usd, right.estimated_api_cost_usd),
    unpriced: left.unpriced_tokens + right.unpriced_tokens,
  })
}

export const value = (id: string): UsageGroupValue => ({ id, unknown: false })
const unknownValue: UsageGroupValue = { id: null, unknown: true }

/** Work on no task: no id, and known to be on none. */
export const noTask: UsageGroupValue = { id: null, unknown: false, reference: null, title: null }
/** Work the store cannot place: no id, and unknown. */
export const unknownTask: UsageGroupValue = { ...noTask, unknown: true }

export const task = (number: number, title: string): UsageGroupValue => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  unknown: false,
  reference: `MAIN-${number}`,
  title,
})

/** One stretch of work: the day of the period it fell in, what it was by, what it spent. */
export interface Stretch {
  day: number
  group: Partial<Record<UsageDimension, UsageGroupValue>>
  spend: Spend
}

const keyOf = (group: Stretch['group']) => JSON.stringify(group)

/** The stretches by the dimensions asked, each a row: a stretch says only what was asked. */
function rowsOf(stretches: readonly Stretch[], dimensions: readonly UsageDimension[]): UsageRow[] {
  const rows = new Map<string, UsageRow>()
  for (const stretch of stretches) {
    const { spend } = stretch
    const group = Object.fromEntries(
      dimensions.map((dimension) => [dimension, stretch.group[dimension] ?? unknownValue]),
    )
    const key = keyOf(group)
    const held = rows.get(key)
    rows.set(key, { group, ...(held ? add(held, measures(spend)) : measures(spend)) })
  }
  return [...rows.values()].toSorted((left, right) => right.agent_seconds - left.agent_seconds)
}

function sumOf(stretches: readonly Stretch[]): UsageMeasures {
  let sum = measures({})
  for (const { spend } of stretches) sum = add(sum, measures(spend))
  return sum
}

function totalOf(stretches: readonly Stretch[]) {
  const total = sumOf(stretches)
  return { ...total, unpriced_models: total.unpriced_tokens ? ['model-unpriced'] : [] }
}

const at = (day: Date) => day.toISOString()

/**
 * The answer for `days` local days from `first`, the last one ending at `end` (now, for a
 * period still running), broken down by `groupBy` and beside `before` when given.
 */
export function usageAnswer(options: {
  days: number
  first: Date
  groupBy: UsageDimension[]
  stretches: readonly Stretch[]
  before?: readonly Stretch[] | null
  end?: Date
}): { interface_version: 'valkama-analytics-api'; usage: Usage } {
  const { first, days, groupBy, stretches } = options
  const dayStart = (index: number) =>
    new Date(first.getFullYear(), first.getMonth(), first.getDate() + index)
  const end = options.end ?? dayStart(days)
  const series = Array.from({ length: days }, (_, index) => {
    const own = stretches.filter((stretch) => stretch.day === index)
    const point = sumOf(own)
    const last = index === days - 1
    const firstOnly = groupBy[0]
    return {
      start: at(dayStart(index)),
      end: at(last ? end : dayStart(index + 1)),
      ...point,
      groups: firstOnly ? rowsOf(own, [firstOnly]) : [],
    }
  })
  const before = options.before
  const length = end.getTime() - first.getTime()
  return {
    interface_version: 'valkama-analytics-api',
    usage: {
      period: { from: at(first), to: at(end), step: 'day', utc_offset: -first.getTimezoneOffset() },
      group_by: groupBy,
      cost_basis: COST_BASIS,
      last_event_at: at(end),
      total: totalOf(stretches),
      rows: rowsOf(stretches, groupBy),
      series,
      comparison: before
        ? {
            period: { from: at(new Date(first.getTime() - length)), to: at(first) },
            total: totalOf(before),
            rows: rowsOf(before, groupBy),
          }
        : null,
    },
  }
}
