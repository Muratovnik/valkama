import { valueKey, valueKind } from '@/pages/analytics/utils/usageValues.ts'
import type { ValueKind } from '@/pages/analytics/utils/usageValues.ts'

import { tokensAnew } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

/**
 * The figures the Analytics page draws from a usage answer, kept apart from the words so a test
 * can hold every number: what a line spent in each measure, how a period changed from the one
 * before it, and which lines a breakdown shows.
 *
 * Tokens are the ones processed anew, as the card counts them (`tokensAnew`): cached reads would
 * dwarf the rest, and reasoning is already part of output. A cost the read has no price for is
 * no data and never a zero; its tokens are counted apart, as `unpriced`.
 */
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type {
  UsageDimension,
  UsageGroupValue,
  UsageMeasures,
  UsageRow,
} from '@/shared/api/analyticsApi.ts'

/** What a line spent: seconds of agent work, tokens anew, an estimated cost and what it leaves out. */
export interface Spent {
  cost: number | null
  seconds: number
  tokens: number | null
  unpriced: number
}

const NOTHING: Spent = { seconds: 0, tokens: null, cost: null, unpriced: 0 }

export const spentOf = (line: UsageMeasures): Spent => ({
  seconds: line.agent_seconds,
  tokens: tokensAnew(line.tokens),
  cost: line.estimated_api_cost_usd,
  unpriced: line.unpriced_tokens,
})

const plus = (left: number | null, right: number | null) =>
  left === null && right === null ? null : (left ?? 0) + (right ?? 0)

const addSpent = (left: Spent, right: Spent): Spent => ({
  seconds: left.seconds + right.seconds,
  tokens: plus(left.tokens, right.tokens),
  cost: plus(left.cost, right.cost),
  unpriced: left.unpriced + right.unpriced,
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

/** Whether a line spent anything at all: some time, a token, a price or tokens without one. */
export const spentAnything = (spent: Spent) =>
  spent.seconds > 0 || Boolean(spent.tokens) || spent.cost !== null || spent.unpriced > 0

/**
 * A measure's figure as the page reads it: its amount; zero for a line that spent nothing; and
 * null — absent, not zero — for one that spent something the measure has no figure for, work
 * with no price or with no token counted.
 */
export function figureOf(measure: Measure, spent: Spent): number | null {
  return measureOf(measure, spent) ?? (spentAnything(spent) ? null : 0)
}

/**
 * How a figure moved from the period before: by how much; that the period before spent nothing,
 * so a rise has no percentage; or which side has no figure to compare (`absent`).
 */
export type Change =
  | { direction: 'down' | 'same' | 'up'; ratio: number }
  | { direction: 'none' }
  | { direction: 'absent'; missing: 'before' | 'both' | 'now' }

/** Under half a percent either way is no change a person reads. */
const STILL = 0.005

/**
 * The change of a measure from `before` to `now`. A figure absent on either side gives no
 * change at all, and says which side it is; a period before that spent nothing is no base.
 */
export function changeOf(measure: Measure, now: Spent, before: Spent): Change {
  const at = figureOf(measure, now)
  const was = figureOf(measure, before)
  if (at === null) return { direction: 'absent', missing: was === null ? 'both' : 'now' }
  if (was === null) return { direction: 'absent', missing: 'before' }
  if (was <= 0) return { direction: 'none' }
  const ratio = (at - was) / was
  if (Math.abs(ratio) < STILL) return { direction: 'same', ratio: 0 }
  return { direction: ratio > 0 ? 'up' : 'down', ratio }
}

/** How many categories a breakdown names before it folds the rest into «other». */
const SHOWN_CATEGORIES = 10

/**
 * Dimensions of a few values, each a kind of work a person asks about by name — the adviser
 * beside the main agent, each way a run was launched — so none is ever folded away.
 */
const NEVER_FOLDED: ReadonlySet<UsageDimension> = new Set(['role', 'launch_class'])

/** A line of a breakdown: a value of the dimension, or the folded tail of `folded` values. */
export interface SpendingLine {
  /** How many values the folded tail holds; 0 for any other line. */
  folded: number
  key: string
  kind: ValueKind | 'other'
  spent: Spent
  /** The value the line names; null for the folded tail. */
  value: UsageGroupValue | null
}

const UNPLACED: UsageGroupValue = { id: null, unknown: true }

/** How much a line weighs in a measure, for its rank: no data weighs nothing. */
const weight = (measure: Measure, line: SpendingLine) => measureOf(measure, line.spent) ?? 0

/**
 * The lines of a breakdown by `dimension`, ranked by `measure`: the largest categories, the rest
 * folded into one «other» line, then work with no value there and work nobody can place, each
 * its own line. Nothing is dropped, so the lines add up to the rows they come from.
 */
export function spendingLines(
  rows: readonly UsageRow[],
  dimension: UsageDimension,
  measure: Measure,
  shown = SHOWN_CATEGORIES,
): SpendingLine[] {
  const byKey = new Map<string, SpendingLine>()
  for (const row of rows) {
    const value = row.group[dimension] ?? UNPLACED
    const key = valueKey(value)
    const held = byKey.get(key)
    const spent = held ? addSpent(held.spent, spentOf(row)) : spentOf(row)
    byKey.set(key, { key, kind: valueKind(value), spent, value, folded: 0 })
  }
  const lines = [...byKey.values()]
  const categories = lines
    .filter((line) => line.kind === 'category')
    .sort(
      (left: SpendingLine, right: SpendingLine) =>
        weight(measure, right) - weight(measure, left) || (left.key < right.key ? -1 : 1),
    )
  const keep = NEVER_FOLDED.has(dimension) ? categories.length : shown
  const tail = categories.slice(keep)
  let folded = NOTHING
  for (const line of tail) folded = addSpent(folded, line.spent)
  const other: SpendingLine[] = tail.length
    ? [{ key: 'other', kind: 'other', spent: folded, value: null, folded: tail.length }]
    : []
  const apart = (kind: ValueKind) => lines.filter((line) => line.kind === kind)
  return [...categories.slice(0, keep), ...other, ...apart('none'), ...apart('unknown')]
}
