/**
 * Tokens by the kinds a read reports them in, per value of a dimension and for the period as a
 * whole. The tokens figure the page draws is what was processed anew — input, cache writes and
 * output — and leaves the cache reads apart; reasoning is a part of output. Split by kind, nothing
 * of that is lost, and a kind no request reported stays absent rather than a zero.
 */
import { pairKey, valueKey } from '@/pages/analytics/utils/usageValues.ts'

import type { Usage, UsageDimension, UsageGroupValue, UsageRow } from '@/shared/api/analyticsApi.ts'
import type { UsageTokens } from '@/shared/api/planningUsageApi.ts'
import { rankSlots } from '@/shared/lib/seriesColors.ts'
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'

/** The kinds, in the order a table names them: what goes in, the cache, what comes out. */
export const TOKEN_KINDS = [
  'input',
  'cached_read',
  'cache_write_5m',
  'cache_write_1h',
  'output',
  'reasoning',
] as const satisfies readonly (keyof UsageTokens)[]

export type TokenKind = (typeof TOKEN_KINDS)[number]

const NONE: UsageTokens = {
  input: null,
  cached_read: null,
  cache_write_5m: null,
  cache_write_1h: null,
  output: null,
  reasoning: null,
}

const plus = (left: number | null, right: number | null) =>
  left === null && right === null ? null : (left ?? 0) + (right ?? 0)

function addTokens(left: UsageTokens, right: UsageTokens): UsageTokens {
  const sum = { ...NONE }
  for (const kind of TOKEN_KINDS) sum[kind] = plus(left[kind], right[kind])
  return sum
}

const UNPLACED: UsageGroupValue = { id: null, unknown: true }

/**
 * Each value's tokens by kind, by the value's key, summed over every row that names it; with
 * `across`, each pair's, by the pair's key.
 */
export function kindsByValue(
  rows: readonly UsageRow[],
  dimension: UsageDimension,
  across: UsageDimension | null = null,
): Map<string, UsageTokens> {
  const kinds = new Map<string, UsageTokens>()
  for (const row of rows) {
    const value = row.group[dimension] ?? UNPLACED
    const key = across ? pairKey(value, row.group[across] ?? UNPLACED) : valueKey(value)
    kinds.set(key, addTokens(kinds.get(key) ?? NONE, row.tokens))
  }
  return kinds
}

/** A value's tokens by kind; none reported for a value the rows do not name. */
export const kindsOf = (kinds: ReadonlyMap<string, UsageTokens>, key: string) =>
  kinds.get(key) ?? NONE

/** The kinds the tokens figure adds up, as the summary counts them: input, cache writes, output. */
const COUNTED_KINDS = [
  'input',
  'cache_write_5m',
  'cache_write_1h',
  'output',
] as const satisfies readonly TokenKind[]

/** The kinds said beside the figure and never in it: cache reads, and reasoning, part of output. */
const APART_KINDS = ['cached_read', 'reasoning'] as const satisfies readonly TokenKind[]

/**
 * The hue of each counted kind, wherever the page draws it: by the kind and not by its rank, so a
 * kind keeps its hue from one period to the next. A kind apart has none.
 */
export const KIND_SLOTS: ReadonlyMap<string, SeriesSlot> = rankSlots(COUNTED_KINDS)

/** A kind of the period: its tokens, in the period before and step by step, null where none. */
export interface KindLine {
  count: number | null
  /** Whether the tokens figure counts it (`COUNTED_KINDS`), or it stands apart. */
  counted: boolean
  kind: TokenKind
  steps: (number | null)[]
  /** In the period compared with; null when it reported none or was not read. */
  before?: number | null
}

/**
 * The period's kinds: the counted ones largest first, then the cache reads and the reasoning in
 * that order. A kind reported neither in the period nor in the period before is left out, so the
 * kinds a client never reports do not stand as zeros.
 */
export function kindLines(usage: Usage): KindLine[] {
  const before = usage.comparison?.total.tokens
  const line = (kind: TokenKind, counted: boolean): KindLine => ({
    kind,
    counted,
    count: usage.total.tokens[kind],
    before: before ? before[kind] : undefined,
    steps: usage.series.map((point) => point.tokens[kind]),
  })
  const reported = (one: KindLine) => one.count !== null || (one.before ?? null) !== null
  const counted = COUNTED_KINDS.map((kind) => line(kind, true))
    .filter((one) => reported(one))
    .sort((left, right) => (right.count ?? 0) - (left.count ?? 0))
  return [
    ...counted,
    ...APART_KINDS.map((kind) => line(kind, false)).filter((one) => reported(one)),
  ]
}

/** What the counted kinds add up to: the tokens figure; null when none was reported. */
export function countedTotal(lines: readonly KindLine[]): number | null {
  const counts = lines.filter((one) => one.counted && one.count !== null)
  return counts.length ? counts.reduce((sum, one) => sum + (one.count ?? 0), 0) : null
}
