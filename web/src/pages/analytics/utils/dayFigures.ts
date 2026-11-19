import {
  breakdownOf,
  figureOf,
  lineKeyOf,
  measureOf,
  spendingLines,
  spentOf,
} from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'
import { valueKey, valueKind } from '@/pages/analytics/utils/usageValues.ts'
import type { ValueKind } from '@/pages/analytics/utils/usageValues.ts'

/**
 * The period day by day: each day's measure stacked by the largest values of the dimension and
 * «other» for the rest, which day is not over yet, and where the known accounts that worked
 * changed.
 * Words come in from the caller; this holds the numbers and which day is which.
 */
import { readAccountId } from '@/shared/api/accountIds.ts'
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type {
  Usage,
  UsageDimension,
  UsageGroupValue,
  UsageRow,
  UsageStep,
} from '@/shared/api/analyticsApi.ts'
import { rankSlots } from '@/shared/lib/seriesColors.ts'
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type { PeriodColumn, PeriodSeries } from '@/shared/ui/chartGeometry.ts'

/** How many values a day's stack names; the rest of the period's values stack as «other». */
const STACKED = 5

const MINUTE = 60_000
/** How long each step of a series is, in ms. */
const STEP_LENGTH: Record<UsageStep, number> = {
  minute: MINUTE,
  hour: 60 * MINUTE,
  day: 24 * 60 * MINUTE,
}

/**
 * A step running at the moment it was read holds what it spent so far: begun, and not over. One
 * still to come holds nothing yet, and is no fall either.
 */
export function unfinished(start: string, step: UsageStep, readAt: Date) {
  const begun = Date.parse(start)
  const now = readAt.getTime()
  return begun <= now && now < begun + STEP_LENGTH[step]
}

/**
 * Whether a step has no data yet: it starts after the newest record the store read
 * (`last_event_at`), so what it holds is not in yet, which is not nothing. The step that record
 * falls in has data, and with no record read at all no step has any.
 */
export function notYet(start: string, lastEventAt: string | null) {
  return lastEventAt === null || Date.parse(start) > Date.parse(lastEventAt)
}

/** A series of the stack: the line it draws, or «other» for the values it does not name. */
export interface StackLine extends PeriodSeries {
  line: SpendingLine | null
}

/**
 * The page's one colour key of a dimension: its categories ranked by the measure over the rows
 * (`spendingLines`), the first `STACKED` of them each a hue by rank, never a hue past them. Work
 * with no value there and unknown work are one neutral (`apart`) and the folded rest (`other`)
 * another, a step lighter: two greys and no hue, so the two largest parts of a day can be told
 * apart without the hint. The rail's tile, the section's bars, small charts and day chart and the
 * overview's chart all read this one key, so a value has one colour on the page; another measure
 * ranks again and may repaint. The rows are the period's without the page's filters
 * (`useColourPlaces`), so a filter that takes a value away repaints none of the rest. Split by
 * `across`, the key is of the pairs, ranked the same way over every pair of the read, so a chart
 * that shows fewer of them paints each as the rest do; a pair with a value that is no category is
 * drawn in the neutral of what is not a category, as such a value is.
 */
export function rankedSlots(
  rows: readonly UsageRow[],
  dimension: UsageDimension,
  measure: Measure,
  across: UsageDimension | null = null,
): Map<string, SeriesSlot> {
  const breakdown = breakdownOf(dimension, across)
  const lines = spendingLines(rows, breakdown, measure, Number.POSITIVE_INFINITY)
  const slots = rankSlots(
    lines
      .filter((line) => line.kind === 'category' && figureOf(measure, line.spent) !== 0)
      .map((line) => line.key),
    STACKED,
  )
  // The folded rest takes no entry: a key with none is `other`, wherever the key is read.
  for (const kind of NOT_CATEGORIES) slots.set(kind, 'apart')
  for (const line of lines) if (line.kind !== 'category') slots.set(line.key, 'apart')
  return slots
}

/** The keys of what is not a category: work with no value in the dimension, unknown work. */
const NOT_CATEGORIES = ['none', 'unknown'] as const satisfies readonly ValueKind[]

/**
 * The values a stack names, bottom first, which is also the legend's order: the answer's largest
 * categories in the measure that hold a hue of the page's key (`rankedSlots`), up to `STACKED`,
 * each in that hue, then work with no value there and unknown work, each its own series in the
 * darker neutral and never folded; only values with anything to draw. The rest of the answer is
 * one «other» series in the lighter neutral, on top: under a filter a value the key gives no hue
 * is folded there rather than named in a grey beside it. Split by `across`, the values are the
 * pairs.
 */
export function stackLines(source: StackSource) {
  const { usage, by: dimension, measure, across = null } = source
  // A value with no figure in the measure stays, so its days can say it has none.
  const breakdown = breakdownOf(dimension, across)
  const lines = spendingLines(usage.rows, breakdown, measure, Number.POSITIVE_INFINITY).filter(
    (line) => figureOf(measure, line.spent) !== 0,
  )
  const slots = rankedSlots(source.places ?? usage.rows, dimension, measure, across)
  const hued = lines.filter(
    (line) => line.kind === 'category' && typeof slots.get(line.key) === 'number',
  )
  const apart = lines.filter((line) => line.kind !== 'category')
  const named = [...hued.slice(0, STACKED), ...apart]
  const series: StackLine[] = named.map((line) => ({
    key: line.key,
    label: '',
    slot: slots.get(line.key) ?? (line.kind === 'category' ? 'other' : 'apart'),
    line,
  }))
  if (lines.length > named.length)
    series.push({ key: 'other', label: '', slot: 'other', line: null })
  return series
}

/**
 * What a stack is drawn from: the answer, the dimension it breaks down by, the measure, the
 * dimension its pairs are split by, where the answer is read by both, and the rows the page's
 * colour key is ranked over (`useColourPlaces`), the answer's own where none is given.
 */
export interface StackSource {
  by: UsageDimension
  measure: Measure
  usage: Usage
  across?: UsageDimension | null
  places?: readonly UsageRow[] | null
}

/**
 * Each day of the answer as a column of the measure, by the series of the stack: by its values,
 * or split, by its pairs. A value that spent in a day with no figure in the measure is absent
 * there, not a zero, and a minute with no data yet (`notYet`) is pending, not a zero either.
 */
export function dayColumns(
  { usage, by: dimension, measure, across = null }: StackSource,
  series: readonly StackLine[],
  readAt: Date,
): Omit<PeriodColumn, 'fullLabel' | 'label'>[] {
  const named = new Set(series.filter((one) => one.line).map((one) => one.key))
  const breakdown = breakdownOf(dimension, across)
  return usage.series.map((point) => {
    const values: Record<string, number> = {}
    const absent = new Set<string>()
    for (const group of point.groups) {
      const key = lineKeyOf(group, breakdown)
      const into = named.has(key) ? key : 'other'
      const figure = figureOf(measure, spentOf(group))
      if (figure === null) absent.add(into)
      else values[into] = (values[into] ?? 0) + figure
    }
    const pending = usage.period.step === 'minute' && notYet(point.start, usage.last_event_at)
    return {
      key: point.start,
      values,
      absent: [...absent],
      incomplete: unfinished(point.start, usage.period.step, readAt),
      ...(pending ? { pending } : {}),
    }
  })
}

/**
 * A change of the known accounts that worked: on which day, which worked before and which then,
 * and so which came that had not worked before and which left that worked before.
 */
export interface AccountChange {
  after: UsageGroupValue[]
  at: string
  before: UsageGroupValue[]
  came: UsageGroupValue[]
  left: UsageGroupValue[]
}

/**
 * The known accounts with a figure above zero in a day, in the measure the chart shows: any
 * figure counts, however small, and none, or no price or token counted, does not. Work no
 * reading places on an account, of an organization or of none, is not an account, so it is not
 * one of them.
 */
const accountsOf = (point: Usage['series'][number], measure: Measure) =>
  point.groups
    .filter((group) => (measureOf(measure, spentOf(group)) ?? 0) > 0)
    .flatMap((group) => {
      const account = group.group.seat
      return account &&
        valueKind(account) === 'category' &&
        readAccountId(account.id ?? '')?.kind !== 'unplaced'
        ? [account]
        : []
    })

const sameKeys = (left: readonly UsageGroupValue[], right: readonly UsageGroupValue[]) => {
  const keys = new Set(left.map((value) => valueKey(value)))
  return keys.size === right.length && right.every((value) => keys.has(valueKey(value)))
}

/** The accounts of `values` that `of` does not hold. */
const outside = (values: readonly UsageGroupValue[], of: readonly UsageGroupValue[]) => {
  const keys = new Set(of.map((value) => valueKey(value)))
  return values.filter((value) => !keys.has(valueKey(value)))
}

/**
 * Where the set of known accounts that worked differs from that of the last day a known account
 * worked, read from an answer by account in the measure the chart shows (`accountsOf`). A day with no known account changes nothing, whether
 * nobody worked or only work nobody recorded the organization of: the next day is compared with
 * the last one that had a known account, so a quiet weekend is not two changes, and unrecorded
 * work beside the same accounts, or between them, is no change at all.
 */
export function accountChanges(byAccount: Usage, measure: Measure): AccountChange[] {
  const changes: AccountChange[] = []
  let last: UsageGroupValue[] | null = null
  for (const point of byAccount.series) {
    const now = accountsOf(point, measure)
    if (!now.length) continue
    if (last && !sameKeys(last, now))
      changes.push({
        at: point.start,
        before: last,
        after: now,
        came: outside(now, last),
        left: outside(last, now),
      })
    last = now
  }
  return changes
}
