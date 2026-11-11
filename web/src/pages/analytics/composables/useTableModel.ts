/**
 * What the table of a dimension's panel holds, as words and numbers to sort by, in one of two
 * shapes:
 *
 * - beside the period before: every value of either period, none folded, with its three measures
 *   now, the chosen one before and its change (`comparedLines`), as the page has always tabled it;
 * - crossed with a second dimension (`crossOf`): every value of the section's dimension against the
 *   leading values of the second, «other», no value and unknown, and the row's total.
 *
 * With the measure «tokens» both add the tokens of each value by kind (`kindsByValue`), so what the
 * tiles say of the kinds stands value by value. Under the rows is the total of every column, from
 * the read's own total. A cell carries the number it sorts by: the figure in its measure, null
 * where the read holds none, which sorts after every figure whichever way the column runs.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { crossOf } from '@/pages/analytics/utils/crossFigures.ts'
import { kindsByValue, kindsOf, TOKEN_KINDS } from '@/pages/analytics/utils/tokenKinds.ts'
import type { TokenKind } from '@/pages/analytics/utils/tokenKinds.ts'
import { changeOf, comparedLines, figureOf, spentOf } from '@/pages/analytics/utils/usageFigures.ts'
import type { Change, Spent } from '@/pages/analytics/utils/usageFigures.ts'

import { MEASURES } from '@/shared/api/analyticsAddress.ts'
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageGroupValue } from '@/shared/api/analyticsApi.ts'
import type { UsageTokens } from '@/shared/api/planningUsageApi.ts'

export interface TableCell {
  /** Whether the cell holds the chosen measure, which reads in the figures' own ink. */
  chosen: boolean
  key: string
  /** The number the column sorts by; null for no figure. */
  sort: number | null
  text: string
}

export interface TableLine {
  cells: TableCell[]
  key: string
  name: string
  /** Whether the line is no value of the dimension: work with no value there, or unknown. */
  rest: boolean
  value: UsageGroupValue
  detail?: string
}

/** Where the table's figures come from: the answer on show, and the crossed read when there is one. */
export interface TableSource {
  by: UsageDimension
  measure: Measure
  usage: Usage
  /** The second dimension and the read by both, when the table is crossed. */
  cross?: { across: UsageDimension; usage: Usage } | null
}

/** A kind the read does not report is absent, not zero. */
const ABSENT = '—'

/** How a change sorts: by its share; from nothing as the largest rise; with no figure, never. */
function changeRank(change: Change | null): number | null {
  if (!change) return null
  if (change.direction === 'none') return Number.POSITIVE_INFINITY
  return change.direction === 'absent' ? null : change.ratio
}

export function useTableModel(source: () => TableSource) {
  const { t } = useI18n()
  const words = useSpendingWords()

  const figureCell = (key: string, measure: Measure, spent: Spent, chosen: boolean) => ({
    key,
    chosen,
    text: words.lineFigure(measure, spent),
    sort: figureOf(measure, spent),
  })

  const kindCells = (tokens: UsageTokens): TableCell[] =>
    source().measure === 'tokens'
      ? TOKEN_KINDS.map((kind) => {
          const count = tokens[kind]
          return {
            key: kind,
            chosen: false,
            text: count === null ? ABSENT : words.scale('tokens', count),
            sort: count,
          }
        })
      : []

  const kindColumns = () =>
    source().measure === 'tokens'
      ? TOKEN_KINDS.map((kind: TokenKind) => ({
          key: kind,
          text: t(`analytics.panel.table.kinds.${kind}`),
          chosen: false,
        }))
      : []

  const lineOf = (value: UsageGroupValue, key: string, kind: string, cells: TableCell[]) => {
    const { by } = source()
    return {
      key,
      value,
      cells,
      rest: kind !== 'category',
      name: words.valueLabel(by, value),
      detail: words.valueDetail(by, value),
    }
  }

  /** Beside the period before: the three measures, the chosen one before and its change. */
  function besideBefore() {
    const { by, measure, usage } = source()
    const { comparison } = usage
    const period = comparison ? words.period(comparison.period.from, comparison.period.to) : ''
    const kinds = kindsByValue(usage.rows, by)
    const columns = [
      ...MEASURES.map((key) => ({
        key,
        text: t(`analytics.panel.table.heads.${key}`),
        chosen: key === measure,
      })),
      ...(comparison
        ? [
            {
              key: 'before',
              text: t('analytics.panel.table.heads.before', { period }),
              chosen: true,
            },
            { key: 'change', text: t('analytics.table.change'), chosen: false },
          ]
        : []),
      ...kindColumns(),
    ]
    const cellsOf = (now: Spent, before: Spent | null, tokens: UsageTokens): TableCell[] => {
      const change = before ? changeOf(measure, now, before) : null
      return [
        ...MEASURES.map((key) => figureCell(key, key, now, key === measure)),
        ...(before && change
          ? [
              figureCell('before', measure, before, true),
              {
                key: 'change',
                chosen: false,
                text: words.lineChange(measure, change, now, before),
                sort: changeRank(change),
              },
            ]
          : []),
        ...kindCells(tokens),
      ]
    }
    const lines = comparedLines({
      rows: usage.rows,
      before: comparison?.rows ?? null,
      dimension: by,
      measure,
      name: (value) => words.valueLabel(by, value),
    }).map((line) =>
      lineOf(
        line.value,
        line.key,
        line.kind,
        cellsOf(line.now, line.before, kindsOf(kinds, line.key)),
      ),
    )
    const total = cellsOf(
      spentOf(usage.total),
      comparison ? spentOf(comparison.total) : null,
      usage.total.tokens,
    )
    const title = t(period ? 'analytics.table.beside' : 'analytics.table.title', {
      by: t(`analytics.byDimension.${by}`),
      period,
    })
    return { title, columns, lines, total, firstSort: measure as string }
  }

  /** Crossed: a column per leading value of the second dimension, then the row's total. */
  function crossed(across: UsageDimension, read: Usage) {
    const { by, measure } = source()
    const { columns, rows, total } = crossOf(read, by, across, measure)
    const kinds = kindsByValue(read.rows, by)
    const nothing: Spent = { seconds: 0, tokens: null, cost: null, unpriced: 0 }
    const cellsOf = (cells: (key: string) => Spent, all: Spent, tokens: UsageTokens) => [
      ...columns.map((column) => figureCell(column.key, measure, cells(column.key), false)),
      figureCell('total', measure, all, true),
      ...kindCells(tokens),
    ]
    const lines = rows.map((row) =>
      lineOf(
        row.value,
        row.key,
        row.kind,
        cellsOf((key) => row.cells.get(key) ?? nothing, row.total, kindsOf(kinds, row.key)),
      ),
    )
    const byColumn = new Map(columns.map((column) => [column.key, column.spent]))
    return {
      title: t('analytics.panel.table.crossTitle', {
        measure: words.measure(measure),
        by: t(`analytics.byDimension.${by}`),
        across: t(`analytics.byDimension.${across}`),
      }),
      columns: [
        ...columns.map((column) => ({
          key: column.key,
          text: words.lineLabel(across, column),
          chosen: false,
        })),
        { key: 'total', text: t('analytics.panel.table.total'), chosen: true },
        ...kindColumns(),
      ],
      lines,
      total: cellsOf((key) => byColumn.get(key) ?? nothing, total, read.total.tokens),
      firstSort: 'total',
    }
  }

  return computed(() => {
    const { cross } = source()
    return cross ? crossed(cross.across, cross.usage) : besideBefore()
  })
}

export type TableModel = ReturnType<typeof useTableModel>['value']
