import { pairKey, pairKind, valueKey, valueKind } from '@/pages/analytics/utils/usageValues.ts'
import type { ValueKind } from '@/pages/analytics/utils/usageValues.ts'

import { LEAST_COST, tokensAnew } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

/**
 * The figures the Analytics page draws from a usage answer, kept apart from the words so a test
 * can hold every number: what a line spent in each measure, how a period changed from the one
 * before it, and which lines a breakdown shows.
 *
 * Tokens are the ones processed anew, as the card counts them (`tokensAnew`): cached reads would
 * dwarf the rest, and reasoning is already part of output. A cost the read has no price for is
 * no data and never a zero; its tokens are counted apart, as `unpriced`.
 */
import { readAccountId, unplacedId } from '@/shared/api/accountIds.ts'
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type {
  Usage,
  UsageDimension,
  UsageGroupValue,
  UsageMeasures,
  UsageRow,
} from '@/shared/api/analyticsApi.ts'
import { MINUTE } from '@/shared/lib/timeSpan.ts'

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

/** What two lines spent together; a figure neither holds stays absent. */
export const addSpent = (left: Spent, right: Spent): Spent => ({
  seconds: left.seconds + right.seconds,
  tokens: plus(left.tokens, right.tokens),
  cost: plus(left.cost, right.cost),
  unpriced: left.unpriced + right.unpriced,
})

/** What lines spent together (`addSpent`); nothing spent for no line. */
export function spentTogether(spent: readonly Spent[]): Spent {
  let sum = NOTHING
  for (const one of spent) sum = addSpent(sum, one)
  return sum
}

const HOUR = 3600

/**
 * A measure as a chart scales it, in its own units: hours of agent time, tokens, dollars. No
 * data draws nothing, and the words beside it say why.
 */
export function measureOf(measure: Measure, spent: Spent): number | null {
  if (measure === 'time') return spent.seconds / HOUR
  return measure === 'tokens' ? spent.tokens : spent.cost
}

/**
 * Whether a line's figure in a measure is less than the least its words count, so that it reads as
 * a span «under a minute», a cost «< $0.01» or no token at all: a row that says nothing of how much.
 * It is judged from the amount and the unit the words use, never from the words: time taken to the
 * millisecond as its words take it, against a minute; a cost against a cent; tokens against one. A
 * line the measure has no amount for says why in words and is never below; nor is a cost that
 * leaves tokens out, since its words say those tokens.
 */
export function belowUnit(measure: Measure, spent: Spent): boolean {
  if (measure === 'time') return Math.round(spent.seconds * 1000) < MINUTE
  const amount = measureOf(measure, spent)
  if (amount === null) return false
  if (measure === 'tokens') return amount < 1
  return spent.unpriced === 0 && amount < LEAST_COST
}

/** Whether a line spent anything at all: some time, a token, a price or tokens without one. */
export const spentAnything = (spent: Spent) =>
  spent.seconds > 0 || Boolean(spent.tokens) || spent.cost !== null || spent.unpriced > 0

/**
 * Whether a line is a value of the period in a measure: a real value, not work with no value there
 * nor work nobody can place, with a figure above zero in the measure. The rail's tile, the table's
 * heading row and «All N» under the ranked bars each count these, so the three say one number.
 */
export const workedValue = (measure: Measure, line: Pick<SpendingLine, 'kind' | 'spent'>) =>
  line.kind === 'category' && (measureOf(measure, line.spent) ?? 0) > 0

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
type Change =
  | { direction: 'down' | 'same' | 'up'; ratio: number }
  | { direction: 'none' }
  | { direction: 'absent'; missing: 'before' | 'both' | 'now' }

/** Under half a percent either way is no change a person reads. */
const STILL = 0.005

/**
 * The change of a measure from `before` to `now`. A figure absent on either side gives no
 * change at all, and says which side it is; a period before that spent nothing is no base.
 */
function changeOf(measure: Measure, now: Spent, before: Spent): Change {
  const at = figureOf(measure, now)
  const was = figureOf(measure, before)
  if (at === null) return { direction: 'absent', missing: was === null ? 'both' : 'now' }
  if (was === null) return { direction: 'absent', missing: 'before' }
  if (was <= 0) return { direction: 'none' }
  const ratio = (at - was) / was
  if (Math.abs(ratio) < STILL) return { direction: 'same', ratio: 0 }
  return { direction: ratio > 0 ? 'up' : 'down', ratio }
}

/**
 * How a figure of accounts moved (`Change`), or, for accounts that spent now, that their figure
 * before is mostly unknown (`unplaced`): their organizations' work no reading placed on an
 * account came to more in the period before than their own did. Which account that work ran
 * under is not known, so a share against their own figure would read where the readings placed
 * the work as growth. Accounts that spent nothing now fell by their whole figure, whatever placed
 * it. The figure is an account's line of a breakdown, or, with the page narrowed to accounts,
 * its total and each line of it, beside that work as the read gives it (`Usage['unplaced']`).
 */
export type LineChange = Change | { direction: 'unplaced' }

/**
 * The change of a figure (`LineChange`), given the unplaced work of its accounts' organizations
 * before, if any: the one rule every change of the page against the period before is said by.
 */
export function lineChangeOf(
  measure: Measure,
  now: Spent,
  before: Spent,
  unplaced?: Spent,
): LineChange {
  const loose = unplaced ? figureOf(measure, unplaced) : null
  const at = figureOf(measure, now) ?? 0
  const was = figureOf(measure, before)
  const unknown = loose !== null && was !== null && at > 0 && loose > was
  return unknown ? { direction: 'unplaced' } : changeOf(measure, now, before)
}

/**
 * What a read narrowed to accounts left out of the period before because no reading placed it on
 * an account, of those accounts' organizations, in total (`Usage['unplaced']`); undefined for a
 * read not narrowed to an account, or one whose period before was not read.
 */
export function unplacedBefore(usage: Usage): Spent | undefined {
  const left = usage.comparison?.unplaced
  return left ? spentOf(left.total) : undefined
}

/** How many categories a breakdown names before it folds the rest into «other». */
const SHOWN_CATEGORIES = 10

/**
 * Dimensions of a few values, each a kind of work a person asks about by name — the adviser
 * beside the main agent, each way a run was launched — so none is ever folded away.
 */
const NEVER_FOLDED: ReadonlySet<UsageDimension> = new Set(['role', 'launch_class'])

/**
 * A line of a breakdown: a value of the dimension, or with a split a pair of it and a value of the
 * dimension it is split by, or the folded tail of `folded` of them.
 */
export interface SpendingLine {
  /** How many values the folded tail holds; 0 for any other line. */
  folded: number
  key: string
  kind: ValueKind | 'other'
  spent: Spent
  /** The value the line names, the first of a pair; null for the folded tail. */
  value: UsageGroupValue | null
  /** A pair's second value, and the dimension it is of; absent for a line of one value. */
  second?: { dimension: UsageDimension; value: UsageGroupValue }
}

const UNPLACED: UsageGroupValue = { id: null, unknown: true }

/**
 * What a breakdown's lines are of: the values of a dimension, or, split by a second one, the pairs
 * of a value of the first and one of the second, in that order.
 */
export type Breakdown = UsageDimension | readonly [UsageDimension, UsageDimension]

/** The breakdown by `by`, split by `across` where one is given. */
export const breakdownOf = (by: UsageDimension, across?: UsageDimension | null): Breakdown =>
  across ? [by, across] : by

/** The line a row adds to: its value of the dimension, or its pair. */
function lineOfRow(row: UsageRow, breakdown: Breakdown) {
  if (typeof breakdown === 'string') {
    const value = row.group[breakdown] ?? UNPLACED
    return { key: valueKey(value), kind: valueKind(value), value }
  }
  const [dimension, across] = breakdown
  const value = row.group[dimension] ?? UNPLACED
  const second = row.group[across] ?? UNPLACED
  return {
    key: pairKey(value, second),
    kind: pairKind(value, second),
    value,
    second: { dimension: across, value: second },
  }
}

/**
 * The key of the line a row adds to, or a group of a step, which the read shapes as a row: its
 * value's key, or its pair's.
 */
export const lineKeyOf = (row: UsageRow, breakdown: Breakdown) => lineOfRow(row, breakdown).key

/** Whether no line of a breakdown is folded: each of its dimensions holds a few values. */
const neverFolded = (breakdown: Breakdown) =>
  (typeof breakdown === 'string' ? [breakdown] : breakdown).every((one) => NEVER_FOLDED.has(one))

const byCodePoint = (left: string, right: string) => {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** How much a line weighs in a measure, for its rank: no data weighs nothing. */
const weight = (measure: Measure, line: SpendingLine) => measureOf(measure, line.spent) ?? 0

/**
 * The lines of a breakdown by a dimension, or by the pairs of two (`Breakdown`), ranked by
 * `measure`: the largest categories, the rest folded into one «other» line, then work with no
 * value there and work nobody can place, each its own line. Nothing is dropped, so the lines add
 * up to the rows they come from.
 */
export function spendingLines(
  rows: readonly UsageRow[],
  breakdown: Breakdown,
  measure: Measure,
  shown = SHOWN_CATEGORIES,
): SpendingLine[] {
  const byKey = new Map<string, SpendingLine>()
  for (const row of rows) {
    const line = lineOfRow(row, breakdown)
    const held = byKey.get(line.key)
    const spent = held ? addSpent(held.spent, spentOf(row)) : spentOf(row)
    byKey.set(line.key, { ...line, spent, folded: 0 })
  }
  const lines = [...byKey.values()]
  const categories = lines
    .filter((line) => line.kind === 'category')
    .sort(
      (left: SpendingLine, right: SpendingLine) =>
        weight(measure, right) - weight(measure, left) || (left.key < right.key ? -1 : 1),
    )
  const keep = neverFolded(breakdown) ? categories.length : shown
  const tail = categories.slice(keep)
  let folded = NOTHING
  for (const line of tail) folded = addSpent(folded, line.spent)
  const other: SpendingLine[] = tail.length
    ? [{ key: 'other', kind: 'other', spent: folded, value: null, folded: tail.length }]
    : []
  const apart = (kind: ValueKind) => lines.filter((line) => line.kind === kind)
  return [...categories.slice(0, keep), ...other, ...apart('none'), ...apart('unknown')]
}

/**
 * The lines of a section's ranked chart by a dimension, or by its pairs (`Breakdown`): every value
 * ranked by its figure in `measure` — work with no value there and work nobody can place among
 * them, where their figures put them — the first `shown` kept and the rest folded into one «other»
 * line, which comes last. A tie keeps the order of the keys. Nothing is dropped.
 */
export function rankedLines(
  rows: readonly UsageRow[],
  breakdown: Breakdown,
  measure: Measure,
  shown = SHOWN_CATEGORIES,
): SpendingLine[] {
  const lines = spendingLines(rows, breakdown, measure, Number.POSITIVE_INFINITY).sort(
    (left: SpendingLine, right: SpendingLine) =>
      weight(measure, right) - weight(measure, left) || byCodePoint(left.key, right.key),
  )
  const keep = neverFolded(breakdown) ? lines.length : shown
  const tail = lines.slice(keep)
  let folded = NOTHING
  for (const line of tail) folded = addSpent(folded, line.spent)
  const other: SpendingLine[] = tail.length
    ? [{ key: 'other', kind: 'other', spent: folded, value: null, folded: tail.length }]
    : []
  return [...lines.slice(0, keep), ...other]
}

/**
 * The key of the line of an account's organization's work no reading placed on an account, in
 * the breakdown the account's line is of: the same line with that work in the account's place.
 * Null for a line that holds no account.
 */
function unplacedKeyOf(
  breakdown: Breakdown,
  line: { value: UsageGroupValue; second?: SpendingLine['second'] },
): string | null {
  const [by, across] = typeof breakdown === 'string' ? [breakdown, null] : breakdown
  let seat: UsageGroupValue | undefined
  if (by === 'seat') seat = line.value
  else if (across === 'seat') seat = line.second?.value
  const read = seat?.id ? readAccountId(seat.id) : null
  if (!read || read.kind === 'unplaced') return null
  const loose: UsageGroupValue = { id: unplacedId(read.organization), unknown: false }
  if (typeof breakdown === 'string') return valueKey(loose)
  return by === 'seat' ? pairKey(loose, line.second?.value ?? UNPLACED) : pairKey(line.value, loose)
}

/** A value of a breakdown, or a pair, in this period beside the period it is compared with. */
export interface ComparedLine {
  /** What the value spent in the period before; null when that period was not read. */
  before: Spent | null
  /** How the chosen measure moved; null when the period before was not read. */
  change: LineChange | null
  key: string
  kind: ValueKind
  now: Spent
  value: UsageGroupValue
  /** A pair's second value, as its line holds it (`SpendingLine`). */
  second?: SpendingLine['second']
  /**
   * The line of the work no reading placed on an account that its change was held to, by its key,
   * and what it spent in the period before (`LineChange`); none where there is no such work.
   */
  unplaced?: { key: string; spent: Spent }
}

/**
 * Every value of `dimension`, or every pair with `across`, that this period or the period before
 * holds, none folded, with what it spent in each and how `measure` moved, by the tiles' own rule
 * (`changeOf`), save a line of accounts whose figure before their organizations' unplaced work
 * outweighed (`LineChange`): an account's own line beside its organization's, and, where the read
 * was narrowed to accounts, any line beside the same line of the work it left out on no account
 * (`unplaced`, the period before's). A value that worked in one period alone spent nothing in the
 * other. `before` is null for a period before that was not read, and then no line has a figure or
 * a change there.
 *
 * Largest first in `measure` this period, a value with no figure there after every figure, and
 * a tie in the order of the names `name` gives, then of the keys.
 */
export function comparedLines(options: {
  before: readonly UsageRow[] | null
  dimension: UsageDimension
  measure: Measure
  rows: readonly UsageRow[]
  across?: UsageDimension | null
  unplaced?: readonly UsageRow[] | null
  name: (value: UsageGroupValue) => string
}): ComparedLine[] {
  const { before, dimension, measure, name, across } = options
  const breakdown = breakdownOf(dimension, across)
  const all = (rows: readonly UsageRow[]) =>
    new Map(
      spendingLines(rows, breakdown, measure, Number.POSITIVE_INFINITY).map((line) => [
        line.key,
        line,
      ]),
    )
  const now = all(options.rows)
  const was = before ? all(before) : new Map<string, SpendingLine>()
  const left = all(options.unplaced ?? [])
  const lines = [...new Set([...now.keys(), ...was.keys()])].map((key): ComparedLine => {
    const line = now.get(key) ?? was.get(key)
    const value = line?.value ?? UNPLACED
    const spent = now.get(key)?.spent ?? NOTHING
    const spentBefore = before ? (was.get(key)?.spent ?? NOTHING) : null
    // An account's own line beside its organization's; any line beside what the filter left out.
    const unplaced = unplacedKeyOf(breakdown, { value, second: line?.second }) ?? key
    const loose = (unplaced === key ? left.get(key) : (was.get(unplaced) ?? left.get(unplaced)))
      ?.spent
    return {
      key,
      kind: line && line.kind !== 'other' ? line.kind : valueKind(value),
      value,
      ...(line?.second ? { second: line.second } : {}),
      now: spent,
      before: spentBefore,
      change: spentBefore ? lineChangeOf(measure, spent, spentBefore, loose) : null,
      ...(loose ? { unplaced: { key: unplaced, spent: loose } } : {}),
    }
  })
  const rank = (line: ComparedLine) => figureOf(measure, line.now) ?? -1
  return lines.sort(
    (left, right) =>
      rank(right) - rank(left) ||
      byCodePoint(name(left.value), name(right.value)) ||
      byCodePoint(left.key, right.key),
  )
}
