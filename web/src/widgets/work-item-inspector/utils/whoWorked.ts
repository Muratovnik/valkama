import type { UsageRole, UsageTokens } from '@/shared/api/planningUsageApi.ts'
import { tokensAnew } from '@/shared/lib/tokensAnew.ts'

/**
 * Who did an item's work, as its Agents tab lists it: the read's rows by role, launch class and
 * effort, added up by role and launch class, since the effort a run took is the Analytics page's
 * to break down. An adviser's row keeps the class of the run it advised in, as the read gives it.
 *
 * A row of under a minute with no tokens processed anew says nothing a reader can use — it read
 * «under a minute · no data · no data» — and is left out. What is left is ranked the way the read
 * ranks: the most time first, then the most cost, then in the read's own order.
 */

export type WhoWorked = Omit<UsageRole, 'effort'>

/** The least time a row with no tokens needs to be listed. */
const LEAST_SECONDS = 60

/** Two counts of one kind: what neither reported stays unreported, and is never a zero. */
const plus = (one: number | null, other: number | null) =>
  one === null && other === null ? null : (one ?? 0) + (other ?? 0)

function addTokens(one: UsageTokens, other: UsageTokens): UsageTokens {
  const sum = { ...one }
  for (const kind of Object.keys(sum) as (keyof UsageTokens)[])
    sum[kind] = plus(one[kind], other[kind])
  return sum
}

const keyOf = (line: WhoWorked) =>
  JSON.stringify([line.role, line.launch_class.id, line.launch_class.unknown])

export function whoWorked(roles: readonly UsageRole[]): WhoWorked[] {
  const merged = new Map<string, WhoWorked>()
  for (const {
    role,
    launch_class,
    seconds,
    tokens,
    estimated_api_cost_usd,
    unpriced_tokens,
  } of roles) {
    const line = { role, launch_class, seconds, tokens, estimated_api_cost_usd, unpriced_tokens }
    const before = merged.get(keyOf(line))
    merged.set(
      keyOf(line),
      before
        ? {
            ...before,
            seconds: before.seconds + seconds,
            tokens: addTokens(before.tokens, tokens),
            estimated_api_cost_usd: plus(before.estimated_api_cost_usd, estimated_api_cost_usd),
            unpriced_tokens: before.unpriced_tokens + unpriced_tokens,
          }
        : line,
    )
  }
  return [...merged.values()]
    .filter((line) => line.seconds >= LEAST_SECONDS || Boolean(tokensAnew(line.tokens)))
    .map((line, order) => ({ line, order }))
    .sort(
      (one, other) =>
        other.line.seconds - one.line.seconds ||
        (other.line.estimated_api_cost_usd ?? 0) - (one.line.estimated_api_cost_usd ?? 0) ||
        one.order - other.order,
    )
    .map(({ line }) => line)
}
