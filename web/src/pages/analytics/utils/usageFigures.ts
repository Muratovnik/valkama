import type { Measure } from '@/pages/analytics/utils/analyticsAddress.ts'

/**
 * The figures the Analytics page draws from a usage answer, kept apart from the words so a test
 * can hold every number: what a line spent in each measure, and how a period changed from the
 * one before it.
 *
 * Tokens are the ones processed anew, as the card counts them (`tokensAnew`): cached reads would
 * dwarf the rest, and reasoning is already part of output. A cost the read has no price for is
 * no data and never a zero; its tokens are counted apart, as `unpriced`.
 */
import { tokensAnew } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { UsageMeasures } from '@/shared/api/analyticsApi.ts'

/** What a line spent: seconds of agent work, tokens anew, an estimated cost and what it leaves out. */
export interface Spent {
  cost: number | null
  seconds: number
  tokens: number | null
  unpriced: number
}

export const spentOf = (line: UsageMeasures): Spent => ({
  seconds: line.agent_seconds,
  tokens: tokensAnew(line.tokens),
  cost: line.estimated_api_cost_usd,
  unpriced: line.unpriced_tokens,
})

const HOUR = 3600

/**
 * A measure as a chart scales it, in its own units: hours of agent time, tokens, dollars. No
 * data draws nothing, and the words beside it say why.
 */
export function measureOf(measure: Measure, spent: Spent): number | null {
  if (measure === 'time') return spent.seconds / HOUR
  return measure === 'tokens' ? spent.tokens : spent.cost
}

/** How a figure moved from the period before: by how much, or that there is nothing to compare. */
export type Change = { direction: 'down' | 'same' | 'up'; ratio: number } | { direction: 'none' }

/** Under half a percent either way is no change a person reads. */
const STILL = 0.005

/**
 * The change from `before` to `now`. A period before with nothing in it, or none read, is no
 * base to compare with: a rise from nothing has no percentage.
 */
export function changeOf(now: number | null, before: number | null): Change {
  if (before === null || before <= 0) return { direction: 'none' }
  const ratio = ((now ?? 0) - before) / before
  if (Math.abs(ratio) < STILL) return { direction: 'same', ratio: 0 }
  return { direction: ratio > 0 ? 'up' : 'down', ratio }
}
