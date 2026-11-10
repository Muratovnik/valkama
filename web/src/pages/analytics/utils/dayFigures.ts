/**
 * The period day by day: each day's measure stacked by the largest values of the dimension and
 * «other» for the rest, which day is not over yet, and where the accounts that worked changed.
 * Words come in from the caller; this holds the numbers and which day is which.
 */
import type { Measure } from '@/pages/analytics/utils/analyticsAddress.ts'
import { measureOf, spendingLines, spentOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'
import { valueKey } from '@/pages/analytics/utils/usageValues.ts'

import type { Usage, UsageDimension, UsageGroupValue } from '@/shared/api/analyticsApi.ts'
import { seriesSlots } from '@/shared/lib/seriesColors.ts'
import type { PeriodColumn, PeriodSeries } from '@/shared/ui/chartGeometry.ts'

/** How many values a day's stack names; the rest of the period's values stack as «other». */
const STACKED = 5

const DAY = 86_400_000

/** A day whose end has not come at the moment it was read holds what it spent so far. */
const unfinished = (start: string, readAt: Date) => Date.parse(start) + DAY > readAt.getTime()

/** A series of the stack: the line it draws, or «other» for the values it does not name. */
export interface StackLine extends PeriodSeries {
  line: SpendingLine | null
}

/**
 * The values a stack names: the period's largest in the measure, with anything to draw. Their
 * hues come from `seriesSlots` over that set, so a value keeps its hue whatever its rank; the
 * rest of the period is one «other» series in the neutral, on top.
 */
export function stackLines({ usage, by: dimension, measure }: StackSource) {
  const lines = spendingLines(usage.rows, dimension, measure, Number.POSITIVE_INFINITY)
    .filter((line) => (measureOf(measure, line.spent) ?? 0) > 0)
    .sort(
      (left, right) =>
        (measureOf(measure, right.spent) ?? 0) - (measureOf(measure, left.spent) ?? 0),
    )
  const named = lines.slice(0, STACKED)
  const slots = seriesSlots(named.map((line) => line.key))
  const series: StackLine[] = [...slots].map(([key, slot]) => ({
    key,
    label: '',
    slot,
    line: named.find((line) => line.key === key) ?? null,
  }))
  if (lines.length > named.length)
    series.push({ key: 'other', label: '', slot: 'other', line: null })
  return series
}

/** What a stack is drawn from: the answer, the dimension it breaks down by, the measure. */
export interface StackSource {
  by: UsageDimension
  measure: Measure
  usage: Usage
}

/** Each day of the answer as a column of the measure, by the series of the stack. */
export function dayColumns(
  { usage, by: dimension, measure }: StackSource,
  series: readonly StackLine[],
  readAt: Date,
): Omit<PeriodColumn, 'fullLabel' | 'label'>[] {
  const named = new Set(series.filter((one) => one.line).map((one) => one.key))
  return usage.series.map((point) => {
    const values: Record<string, number> = {}
    for (const group of point.groups) {
      const value = group.group[dimension]
      const key = value ? valueKey(value) : 'unknown'
      const into = named.has(key) ? key : 'other'
      values[into] = (values[into] ?? 0) + (measureOf(measure, spentOf(group)) ?? 0)
    }
    return { key: point.start, values, incomplete: unfinished(point.start, readAt) }
  })
}

/** Whether a group spent anything at all in its day. */
const spentAnything = (group: Usage['rows'][number]) => {
  const spent = spentOf(group)
  return spent.seconds > 0 || Boolean(spent.tokens) || spent.cost !== null || spent.unpriced > 0
}

/** A change of the accounts that worked: on which day, which worked before and which then. */
export interface AccountChange {
  after: UsageGroupValue[]
  at: string
  before: UsageGroupValue[]
}

const accountsOf = (point: Usage['series'][number]) =>
  point.groups
    .filter((group) => spentAnything(group))
    .flatMap((group) => (group.group.account ? [group.group.account] : []))

const sameKeys = (left: readonly UsageGroupValue[], right: readonly UsageGroupValue[]) => {
  const keys = new Set(left.map((value) => valueKey(value)))
  return keys.size === right.length && right.every((value) => keys.has(valueKey(value)))
}

/**
 * Where the set of accounts that worked differs from the last day anyone worked, read from an
 * answer by account. A day nobody worked changes nothing: the next day is compared with the last
 * one that had work, so a quiet weekend is not two changes.
 */
export function accountChanges(byAccount: Usage): AccountChange[] {
  const changes: AccountChange[] = []
  let last: UsageGroupValue[] | null = null
  for (const point of byAccount.series) {
    const now = accountsOf(point)
    if (!now.length) continue
    if (last && !sameKeys(last, now)) changes.push({ at: point.start, before: last, after: now })
    last = now
  }
  return changes
}
