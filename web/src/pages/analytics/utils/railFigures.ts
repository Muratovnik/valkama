import { unfinished } from '@/pages/analytics/utils/dayFigures.ts'
import {
  figureOf,
  lineChangeOf,
  measureOf,
  spendingLines,
  spentAnything,
  spentOf,
  unplacedBefore,
  workedValue,
} from '@/pages/analytics/utils/usageFigures.ts'
import type { LineChange, SpendingLine, Spent } from '@/pages/analytics/utils/usageFigures.ts'

/**
 * The figures of the rail's tiles, kept apart from the words so a test can hold every number.
 *
 * The overview's tile is the period's total in the chosen measure, how it moved from the period
 * before and the period day by day. A rise from a base so small that its percentage says nothing
 * — a tenth of the figure now or less — is said by the base itself (`from`), as a period before
 * that spent nothing already is (`none`). Narrowed to accounts whose organizations' work on no
 * account outweighed their own before, it moved by nothing anybody can say (`unplaced`).
 *
 * A dimension's tile is how many values worked in the period in the measure, the first of them
 * with its share of the whole, and the shares of the first few, what they leave out folded into
 * one rest. A value worked in the measure when it has a figure there above zero: the adviser's
 * tokens are no agent time, so under time it is no value of the period, and work with no price
 * is none under the cost. The count is of real values, as the table's count of the period is;
 * work with no value there and work nobody can place are not among them, and neither is a first
 * value while a real one worked; they are part of the whole, and of the rest, except work with
 * no value there that holds a share a reader should not miss (`APART_PART`): that is a part of
 * its own, after the values and before the rest, so the largest bucket is never hidden inside
 * the rest.
 */
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageRow } from '@/shared/api/analyticsApi.ts'

/** How the overview's total moved: a change as the page's tiles say it, or the small base. */
export type RailChange = LineChange | { before: Spent; direction: 'from' }

/** A rise to this many times the figure before or more is said by that figure, not a percentage. */
const SMALL_BASE = 10

/** A day of the period in the measure; null where the day has no figure there. */
interface TrendDay {
  incomplete: boolean
  key: string
  value: number | null
}

export interface OverviewFigures {
  /** How the total moved; null when the period before was not read. */
  change: RailChange | null
  total: Spent
  trend: TrendDay[]
}

/** The overview's figures from an answer that carries the period before, or none if not read. */
export function overviewFigures(usage: Usage, measure: Measure, readAt: Date): OverviewFigures {
  const total = spentOf(usage.total)
  const before = usage.comparison ? spentOf(usage.comparison.total) : null
  return {
    total,
    change: before ? railChange(measure, total, before, unplacedBefore(usage)) : null,
    trend: usage.series.map((day) => ({
      key: day.start,
      value: measureOf(measure, spentOf(day)),
      incomplete: unfinished(day.start, usage.period.step, readAt),
    })),
  }
}

/**
 * How `now` moved from `before` in a measure, by the page's own rule (`lineChangeOf`) beside the
 * work left out on no account before (`unplaced`), a small base apart.
 */
export function railChange(
  measure: Measure,
  now: Spent,
  before: Spent,
  unplaced?: Spent,
): RailChange {
  const change = lineChangeOf(measure, now, before, unplaced)
  if (change.direction !== 'up') return change
  const was = figureOf(measure, before) ?? 0
  const at = figureOf(measure, now) ?? 0
  return at >= was * SMALL_BASE ? { direction: 'from', before } : change
}

/** How many of the first values the share bar names; the rest is one part after them. */
const NAMED_PARTS = 4

/** A share under this is no part a reader can see; it goes to the rest. */
const SMALLEST_PART = 0.02

/** Work with no value there holding this share or more is a part of its own, not in the rest. */
const APART_PART = 0.05

/** What is left of the whole under half a percent is rounding, not a rest. */
const ROUNDING = 0.005

/**
 * A part of the share bar: a value with its share, work with no value there (`line.kind` is
 * `none`), or the rest (`line` null).
 */
interface SharePortion {
  key: string
  line: SpendingLine | null
  share: number
}

export interface DimensionFigures {
  /**
   * How many values of the dimension have a figure above zero in the measure, work with no value
   * there aside.
   */
  count: number
  /** The first value in the measure — a real one while any worked — and its share, if any. */
  first: { line: SpendingLine; share: number | null }
  parts: SharePortion[]
}

/**
 * A dimension's figures in a measure from its breakdown; null when the period spent nothing,
 * which the tile says in words rather than as a zero.
 */
export function dimensionFigures(
  rows: readonly UsageRow[],
  dimension: UsageDimension,
  measure: Measure,
): DimensionFigures | null {
  const lines = spendingLines(rows, dimension, measure, Number.POSITIVE_INFINITY).filter((line) =>
    spentAnything(line.spent),
  )
  const weight = (line: SpendingLine) => measureOf(measure, line.spent) ?? 0
  const categories = lines.filter((line) => workedValue(measure, line))
  const first =
    categories[0] ?? [...lines].sort((left, right) => weight(right) - weight(left)).at(0)
  if (!first) return null
  const whole = lines.reduce((sum, line) => sum + weight(line), 0)
  const shareOf = (line: SpendingLine) => (whole > 0 ? weight(line) / whole : 0)
  const named = categories
    .slice(0, NAMED_PARTS)
    .filter((line) => shareOf(line) >= SMALLEST_PART)
    .map((line) => ({ key: line.key, line, share: shareOf(line) }))
  const none = lines.find((line) => line.kind === 'none')
  if (none && whole > 0 && shareOf(none) >= APART_PART)
    named.push({ key: none.key, line: none, share: shareOf(none) })
  const rest = whole > 0 ? 1 - named.reduce((sum, part) => sum + part.share, 0) : 0
  return {
    count: categories.length,
    first: { line: first, share: whole > 0 ? shareOf(first) : null },
    parts: rest >= ROUNDING ? [...named, { key: 'rest', line: null, share: rest }] : named,
  }
}
