/**
 * What the Analytics read answers, built from stretches of work so that its figures add up the
 * way the contract says: the rows to the total, the days to the total, a day's groups to the
 * day. Every id, name and number is made up.
 *
 * `role` is a dimension the read is gaining; until the server answers by it, it is here.
 */
import { isUsageDimension, USAGE_DIMENSIONS } from '@/shared/api/analyticsApi.ts'
import type {
  Usage,
  UsageDimension,
  UsageGroupValue,
  UsageMeasures,
  UsageRow,
} from '@/shared/api/analyticsApi.ts'

const COST_BASIS =
  'An estimate at public API list prices for each request. A subscription pays differently, so this is not a bill.'

/**
 * What one stretch spent: seconds, tokens processed anew, a price and the tokens without one.
 * The tokens anew are split as a read gives them — input, output with its reasoning inside it,
 * cache writes — beside cache reads ten times their size, which no figure counts: a sum that
 * took the cache reads in, or took one kind for all, would not add up to `tokens`.
 */
interface Spend {
  cost?: number | null
  seconds?: number
  tokens?: number | null
  unpriced?: number
}

/** The kinds `tokens` anew are split into: half input, three tenths output, the rest cache writes. */
function split(tokens: number | null): UsageMeasures['tokens'] {
  if (tokens === null)
    return {
      input: null,
      cached_read: null,
      cache_write_5m: null,
      cache_write_1h: null,
      output: null,
      reasoning: null,
    }
  const input = Math.round(tokens / 2)
  const output = Math.round((tokens * 3) / 10)
  return {
    input,
    cached_read: tokens * 10,
    cache_write_5m: tokens - input - output,
    cache_write_1h: null,
    output,
    reasoning: Math.floor(output / 3),
  }
}

function measures({ seconds = 0, tokens = null, cost = null, unpriced = 0 }: Spend): UsageMeasures {
  return {
    agent_seconds: seconds,
    estimated_seconds: 0,
    quality: seconds > 0 ? 'observed' : null,
    tokens: split(tokens),
    estimated_api_cost_usd: cost,
    unpriced_tokens: unpriced,
  }
}

const plus = (left: number | null, right: number | null) =>
  left === null && right === null ? null : (left ?? 0) + (right ?? 0)

function add(left: UsageMeasures, right: UsageMeasures): UsageMeasures {
  const tokens = { ...left.tokens }
  for (const kind of Object.keys(tokens) as (keyof UsageMeasures['tokens'])[])
    tokens[kind] = plus(left.tokens[kind], right.tokens[kind])
  return {
    ...measures({
      seconds: left.agent_seconds + right.agent_seconds,
      cost: plus(left.estimated_api_cost_usd, right.estimated_api_cost_usd),
      unpriced: left.unpriced_tokens + right.unpriced_tokens,
    }),
    tokens,
  }
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

/** One stretch of work at its moment, for a stand-in that answers each query by what it asks. */
export interface TimedStretch {
  at: Date
  group: Stretch['group']
  spend: Spend
}

const DAY = 86_400_000
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/u

/** A moment of the query: a date is the start of that day at the query's offset. */
function instant(text: string, offset: number) {
  const date = DATE.exec(text)
  if (!date) return Date.parse(text)
  const [, year = 1970, month = 1, day = 1] = date.map(Number)
  return Date.UTC(year, month - 1, day) - offset * 60_000
}

/** The dimensions whose «none» is work with no value there; elsewhere it is an unknown value. */
const NONE_IS_NO_VALUE: ReadonlySet<UsageDimension> = new Set(['work_item', 'launch_class'])

/** Whether every filter of the query admits a stretch, `none` as the contract reads it. */
function admits(query: URLSearchParams, group: Stretch['group']) {
  const none = new Set(query.get('none')?.split(',') ?? [])
  return USAGE_DIMENSIONS.every((dimension) => {
    const named = query.get(dimension)?.split(',') ?? []
    if (!named.length && !none.has(dimension)) return true
    const value = group[dimension] ?? unknownValue
    const isNone = NONE_IS_NO_VALUE.has(dimension)
      ? value.id === null && !value.unknown
      : dimension !== 'role' && value.unknown
    return (value.id !== null && named.includes(value.id)) || (none.has(dimension) && isNone)
  })
}

/**
 * Where the read cuts a period into days: at its start, at every midnight of the asked offset
 * inside it and at its end. The days are fixed steps of 24 hours at that one offset, whatever
 * the browser's zone does in between: the read has no zone, only the offset it was asked at.
 */
function dayEdges(from: number, to: number, offset: number) {
  const shift = offset * 60_000
  const edges = [from]
  for (let edge = (Math.floor((from + shift) / DAY) + 1) * DAY - shift; edge < to; edge += DAY)
    edges.push(edge)
  edges.push(to)
  return edges
}

/**
 * What the read answers to `query` over `stretches`, from the query alone: only the work its
 * period, its filters and its project admit, by what it groups by, beside the period of the same
 * length before it when it compares. Its moments are written and its days cut at the query's
 * `utc_offset`. A query that asks for the wrong period, filter, scope or offset gets other figures
 * or other days.
 */
export function serveUsage(stretches: readonly TimedStretch[], query: URLSearchParams) {
  const offset = Number(query.get('utc_offset') ?? 0)
  const from = instant(query.get('from') ?? '', offset)
  const to = instant(query.get('to') ?? '', offset)
  const edges = dayEdges(from, to, offset)
  const groupBy = (query.get('group_by')?.split(',') ?? []).filter(isUsageDimension)
  const within = (start: number, end: number) =>
    stretches
      .filter((one) => one.at.getTime() >= start && one.at.getTime() < end)
      .filter((one) => admits(query, one.group))
      .map((one) => ({
        day: edges.findLastIndex((edge) => edge <= one.at.getTime()),
        group: one.group,
        spend: one.spend,
      }))
  return answerOf({
    edges,
    offset,
    groupBy,
    stretches: within(from, to),
    before: query.get('compare') === 'true' ? within(from - (to - from), from) : null,
  })
}

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * A moment as the read writes it, at the offset the period was asked at:
 * `2030-03-04T00:00:00+03:00`. The browser's own offset at that moment by default.
 */
export function momentAt(moment: Date | number, offset = -new Date(moment).getTimezoneOffset()) {
  const wall = new Date(new Date(moment).getTime() + offset * 60_000).toISOString().slice(0, 19)
  const size = Math.abs(offset)
  return `${wall}${offset < 0 ? '-' : '+'}${pad(Math.floor(size / 60))}:${pad(size % 60)}`
}

type Answer = { interface_version: 'valkama-analytics-api'; usage: Usage }

/**
 * The answer for the days between `edges`, each moment written at `offset`, broken down by
 * `groupBy` and beside `before`, the period of the same length right before, when given.
 */
function answerOf(options: {
  edges: readonly number[]
  groupBy: UsageDimension[]
  offset: number
  stretches: readonly Stretch[]
  before?: readonly Stretch[] | null
}): Answer {
  const { edges, offset, groupBy, stretches, before } = options
  const at = (moment: number) => momentAt(moment, offset)
  const first = edges[0] ?? 0
  const end = edges.at(-1) ?? first
  const series = edges.slice(1).map((next, index) => {
    const own = stretches.filter((stretch) => stretch.day === index)
    const firstOnly = groupBy[0]
    return {
      start: at(edges[index] ?? first),
      end: at(next),
      ...sumOf(own),
      groups: firstOnly ? rowsOf(own, [firstOnly]) : [],
    }
  })
  return {
    interface_version: 'valkama-analytics-api',
    usage: {
      period: { from: at(first), to: at(end), step: 'day', utc_offset: offset },
      group_by: groupBy,
      cost_basis: COST_BASIS,
      last_event_at: at(end),
      total: totalOf(stretches),
      rows: rowsOf(stretches, groupBy),
      series,
      comparison: before
        ? {
            period: { from: at(2 * first - end), to: at(first) },
            total: totalOf(before),
            rows: rowsOf(before, groupBy),
          }
        : null,
    },
  }
}

/**
 * The answer for `days` days from `first`, the last one ending at `end` (now, for a period still
 * running), broken down by `groupBy` and beside `before` when given. The days are steps of 24
 * hours at `offset`, the browser's own offset at `first` unless the test names another.
 */
export function usageAnswer(options: {
  days: number
  first: Date
  groupBy: UsageDimension[]
  stretches: readonly Stretch[]
  before?: readonly Stretch[] | null
  end?: Date
  offset?: number
}): Answer {
  const { first, days } = options
  const edges = Array.from({ length: days + 1 }, (_, index) => first.getTime() + index * DAY)
  if (options.end) edges[days] = options.end.getTime()
  return answerOf({ ...options, edges, offset: options.offset ?? -first.getTimezoneOffset() })
}
