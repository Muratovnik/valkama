/**
 * A dimension's values day by day, one small chart each, and the hue each value is drawn in
 * across the panel of that dimension. Words come in from the caller; this holds the numbers.
 */
import { stackLines } from '@/pages/analytics/utils/dayFigures.ts'
import type { StackSource } from '@/pages/analytics/utils/dayFigures.ts'
import { figureOf, spendingLines, spentOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'
import { valueKey } from '@/pages/analytics/utils/usageValues.ts'

import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'

/** How many values a dimension's small charts name before the rest are one chart of «other». */
const CHARTED = 8

/**
 * The hue of each value the day chart stacks (`stackLines`, the page's ranked key), so a value
 * has the one hue in the day chart, its small chart and its bar. A value the day chart folds into «other» has
 * none, and is drawn in the neutral everywhere.
 */
export function valueSlots(source: StackSource): Map<string, SeriesSlot> {
  return new Map(stackLines(source).flatMap((one) => (one.line ? [[one.key, one.slot]] : [])))
}

/** A line of the small charts, with its figure in each day of the answer; null for no figure. */
export interface DayMultiple {
  line: SpendingLine
  values: (number | null)[]
}

/**
 * The lines of the small charts: the largest categories in the measure, the rest folded into one
 * «other», then work with no value there and work nobody can place (`spendingLines`), each with
 * its figure day by day. A day a line spent in without a figure in the measure is null, not zero.
 */
export function dayMultiples({ usage, by, measure }: StackSource): DayMultiple[] {
  const lines = spendingLines(usage.rows, by, measure, CHARTED)
  const named = new Set(lines.map((line) => line.key))
  const days = usage.series.map((point) => {
    const sums = new Map<string, number | null>()
    for (const group of point.groups) {
      const value = group.group[by]
      const key = value ? valueKey(value) : 'unknown'
      const into = named.has(key) ? key : 'other'
      const figure = figureOf(measure, spentOf(group))
      const held = sums.get(into)
      sums.set(into, figure === null ? (held ?? null) : (held ?? 0) + figure)
    }
    return sums
  })
  return lines.map((line) => ({
    line,
    values: days.map((sums) => (sums.has(line.key) ? (sums.get(line.key) ?? null) : 0)),
  }))
}
