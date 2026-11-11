/**
 * A dimension crossed with a second one, from a read by both: a row per value of the first, a
 * column per leading value of the second, the rest of its categories folded into «other», and
 * work with no value there and work nobody can place as columns of their own, never folded
 * (`spendingLines`). Every cell is what the pair spent; the rows add up to the columns' totals and
 * both to the read's total. Words come in from the caller; this holds the numbers.
 */
import { addSpent, spendingLines, spentOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine, Spent } from '@/pages/analytics/utils/usageFigures.ts'
import { valueKey, valueKind } from '@/pages/analytics/utils/usageValues.ts'
import type { ValueKind } from '@/pages/analytics/utils/usageValues.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageGroupValue } from '@/shared/api/analyticsApi.ts'

/** How many categories of the second dimension the table names before it folds the rest. */
const ACROSS_SHOWN = 5

const NOTHING: Spent = { seconds: 0, tokens: null, cost: null, unpriced: 0 }
const UNPLACED: UsageGroupValue = { id: null, unknown: true }

interface CrossRow {
  /** What the value spent in each column, by the column's key; a column it did not spend in is absent. */
  cells: Map<string, Spent>
  key: string
  kind: ValueKind
  /** What the value spent across every column. */
  total: Spent
  value: UsageGroupValue
}

interface Crossed {
  /** The columns, largest first in the measure, then «other», no value and unknown. */
  columns: SpendingLine[]
  rows: CrossRow[]
  /** What the whole read spent. */
  total: Spent
}

/** The cells of a read by `by` and `across`; `measure` ranks the columns and the rows. */
export function crossOf(
  usage: Usage,
  by: UsageDimension,
  across: UsageDimension,
  measure: Measure,
): Crossed {
  const columns = spendingLines(usage.rows, across, measure, ACROSS_SHOWN)
  const named = new Set(columns.map((column) => column.key))
  const rows: CrossRow[] = spendingLines(usage.rows, by, measure, Number.POSITIVE_INFINITY).map(
    (line) => {
      const value = line.value ?? UNPLACED
      return { key: line.key, kind: valueKind(value), value, total: line.spent, cells: new Map() }
    },
  )
  const byKey = new Map(rows.map((row) => [row.key, row]))
  for (const row of usage.rows) {
    const into = valueKey(row.group[across] ?? UNPLACED)
    const column = named.has(into) ? into : 'other'
    const cells = byKey.get(valueKey(row.group[by] ?? UNPLACED))?.cells
    cells?.set(column, addSpent(cells.get(column) ?? NOTHING, spentOf(row)))
  }
  return { columns, rows, total: spentOf(usage.total) }
}
