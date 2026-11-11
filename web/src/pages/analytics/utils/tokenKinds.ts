/**
 * Tokens by the kinds a read reports them in, per value of a dimension. The tokens figure the
 * page draws is what was processed anew — input, cache writes and output — and leaves the cache
 * reads apart; reasoning is a part of output. Split by kind, nothing of that is lost, and a kind
 * no request reported stays absent rather than a zero.
 */
import { valueKey } from '@/pages/analytics/utils/usageValues.ts'

import type { UsageDimension, UsageGroupValue, UsageRow } from '@/shared/api/analyticsApi.ts'
import type { UsageTokens } from '@/shared/api/planningUsageApi.ts'

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

/** Each value's tokens by kind, by the value's key, summed over every row that names it. */
export function kindsByValue(
  rows: readonly UsageRow[],
  dimension: UsageDimension,
): Map<string, UsageTokens> {
  const kinds = new Map<string, UsageTokens>()
  for (const row of rows) {
    const key = valueKey(row.group[dimension] ?? UNPLACED)
    kinds.set(key, addTokens(kinds.get(key) ?? NONE, row.tokens))
  }
  return kinds
}

/** A value's tokens by kind; none reported for a value the rows do not name. */
export const kindsOf = (kinds: ReadonlyMap<string, UsageTokens>, key: string) =>
  kinds.get(key) ?? NONE
