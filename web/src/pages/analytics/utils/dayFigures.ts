import {
  figureOf,
  measureOf,
  spendingLines,
  spentAnything,
  spentOf,
} from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'
import { valueKey, valueKind } from '@/pages/analytics/utils/usageValues.ts'

/**
 * The period day by day: each day's measure stacked by the largest values of the dimension and
 * «other» for the rest, which day is not over yet, and where the known accounts that worked
 * changed.
 * Words come in from the caller; this holds the numbers and which day is which.
 */
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageGroupValue } from '@/shared/api/analyticsApi.ts'
import { SERIES_SLOT_COUNT, seriesSlots } from '@/shared/lib/seriesColors.ts'
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
 * The values a stack names: work with no value there and unknown work, each its own series as
 * in the bars and never folded, and the period's largest categories in the measure, as many as
 * the palette has hues left for, up to `STACKED`; only values with anything to draw. Their hues
 * come from `seriesSlots` over that set, so a value keeps its hue whatever its rank; the rest of
 * the period is one «other» series in the neutral, on top.
 */
export function stackLines({ usage, by: dimension, measure }: StackSource) {
  const amount = (line: SpendingLine) => measureOf(measure, line.spent) ?? 0
  // A value with no figure in the measure stays, so its days can say it has none.
  const lines = spendingLines(usage.rows, dimension, measure, Number.POSITIVE_INFINITY).filter(
    (line) => figureOf(measure, line.spent) !== 0,
  )
  const apart = lines.filter((line) => line.kind !== 'category')
  const categories = lines
    .filter((line) => line.kind === 'category')
    .sort((left, right) => amount(right) - amount(left))
  const room = Math.min(STACKED, SERIES_SLOT_COUNT - apart.length)
  const named = [...apart, ...categories.slice(0, room)]
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

/**
 * Each day of the answer as a column of the measure, by the series of the stack. A value that
 * spent in a day with no figure in the measure is absent there, not a zero.
 */
export function dayColumns(
  { usage, by: dimension, measure }: StackSource,
  series: readonly StackLine[],
  readAt: Date,
): Omit<PeriodColumn, 'fullLabel' | 'label'>[] {
  const named = new Set(series.filter((one) => one.line).map((one) => one.key))
  return usage.series.map((point) => {
    const values: Record<string, number> = {}
    const absent = new Set<string>()
    for (const group of point.groups) {
      const value = group.group[dimension]
      const key = value ? valueKey(value) : 'unknown'
      const into = named.has(key) ? key : 'other'
      const figure = figureOf(measure, spentOf(group))
      if (figure === null) absent.add(into)
      else values[into] = (values[into] ?? 0) + figure
    }
    return {
      key: point.start,
      values,
      absent: [...absent],
      incomplete: unfinished(point.start, readAt),
    }
  })
}

/** A change of the known accounts that worked: on which day, which worked before and which then. */
export interface AccountChange {
  after: UsageGroupValue[]
  at: string
  before: UsageGroupValue[]
}

/**
 * The known accounts that spent anything in a day. Work whose organization nobody recorded is
 * not an account, so it is not one of them.
 */
const accountsOf = (point: Usage['series'][number]) =>
  point.groups
    .filter((group) => spentAnything(spentOf(group)))
    .flatMap((group) => {
      const account = group.group.account
      return account && valueKind(account) === 'category' ? [account] : []
    })

const sameKeys = (left: readonly UsageGroupValue[], right: readonly UsageGroupValue[]) => {
  const keys = new Set(left.map((value) => valueKey(value)))
  return keys.size === right.length && right.every((value) => keys.has(valueKey(value)))
}

/**
 * Where the set of known accounts that worked differs from that of the last day a known account
 * worked, read from an answer by account. A day with no known account changes nothing, whether
 * nobody worked or only work nobody recorded the organization of: the next day is compared with
 * the last one that had a known account, so a quiet weekend is not two changes, and unrecorded
 * work beside the same accounts, or between them, is no change at all.
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
