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
import {
  changeOf,
  comparedLines,
  figureOf,
  spentAnything,
  spentOf,
} from '@/pages/analytics/utils/usageFigures.ts'
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

/** A column's heading: its name, and what the name leaves out, for its hint. */
export interface TableColumn {
  /** Whether the column holds the chosen measure, which reads in the figures' own ink. */
  chosen: boolean
  key: string
  text: string
  detail?: string
}

export interface TableLine {
  cells: TableCell[]
  key: string
  name: string
  /** Whether the line is no value of the dimension: work with no value there, or unknown. */
  rest: boolean
  value: UsageGroupValue
  /** When the line spent: in this period, only in the period before, or in neither. */
  when: 'before' | 'neither' | 'now'
  detail?: string
}

/** What the rows of a table are, as its heading row counts them. */
export interface TableCounts {
  /** The names of the rows of no value of the dimension that spent in this period. */
  apart: string[]
  /** Rows that spent only in the period before. */
  before: number
  /** Values of the dimension that spent anything in this period, as the rail's tile counts them. */
  now: number
}

/**
 * How many rows of a table are values of this period and how many spent only before, and which
 * rows of no value spent in this period: together, every row that spent anything.
 */
export function tableCounts(lines: readonly TableLine[]): TableCounts {
  const now = lines.filter((line) => line.when === 'now')
  return {
    now: now.filter((line) => !line.rest).length,
    before: lines.filter((line) => line.when === 'before').length,
    apart: now.filter((line) => line.rest).map((line) => line.name),
  }
}

/** When a line spent, from what it spent now and, where read, before. */
function whenOf(now: Spent, before: Spent | null): TableLine['when'] {
  if (spentAnything(now)) return 'now'
  return before && spentAnything(before) ? 'before' : 'neither'
}

/** Where the table's figures come from: the answer on show, and the crossed read when there is one. */
export interface TableSource {
  by: UsageDimension
  measure: Measure
  usage: Usage
  /** The second dimension and the read by both, when the table is crossed. */
  cross?: { across: UsageDimension; usage: Usage } | null
}

/** A kind the read does not report is absent, not zero; so is a crossed pair that spent nothing. */
const ABSENT = '—'

/** A crossed pair with no cell spent nothing in the measure: an empty cell, not a zero. */
const emptyCell = (key: string): TableCell => ({ key, chosen: false, text: ABSENT, sort: 0 })

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

  /** A line of the table, and when it spent (`whenOf`). */
  const lineOf = (
    value: UsageGroupValue,
    key: string,
    kind: string,
    [cells, when]: [TableCell[], TableLine['when']],
  ): TableLine => {
    const { by } = source()
    return {
      key,
      value,
      cells,
      when,
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
    const columns: TableColumn[] = [
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
      lineOf(line.value, line.key, line.kind, [
        cellsOf(line.now, line.before, kindsOf(kinds, line.key)),
        whenOf(line.now, line.before),
      ]),
    )
    const total = cellsOf(
      spentOf(usage.total),
      comparison ? spentOf(comparison.total) : null,
      usage.total.tokens,
    )
    // The period compared with is named in its column's heading, so the title need not say it.
    const title = t('analytics.table.title', { by: t(`analytics.byDimension.${by}`) })
    return { title, columns, lines, total, firstSort: measure as string }
  }

  /** Crossed: a column per leading value of the second dimension, then the row's total. */
  function crossed(across: UsageDimension, read: Usage) {
    const { by, measure } = source()
    const { columns, rows, total } = crossOf(read, by, across, measure)
    const kinds = kindsByValue(read.rows, by)
    const cellsOf = (
      cells: (key: string) => Spent | undefined,
      all: Spent,
      tokens: UsageTokens,
    ) => [
      ...columns.map((column) => {
        const spent = cells(column.key)
        return spent ? figureCell(column.key, measure, spent, false) : emptyCell(column.key)
      }),
      figureCell('total', measure, all, true),
      ...kindCells(tokens),
    ]
    const lines = rows.map((row) =>
      lineOf(row.value, row.key, row.kind, [
        cellsOf((key) => row.cells.get(key), row.total, kindsOf(kinds, row.key)),
        whenOf(row.total, null),
      ]),
    )
    const byColumn = new Map(columns.map((column) => [column.key, column.spent]))
    const headings: TableColumn[] = [
      ...columns.map((column) => ({
        key: column.key,
        text: words.lineLabel(across, column),
        // What the heading's name leaves out, as a row's would: a session's id, an account's.
        detail: words.valueDetail(across, column.value),
        chosen: false,
      })),
      { key: 'total', text: t('analytics.panel.table.total'), chosen: true },
      ...kindColumns(),
    ]
    return {
      title: t('analytics.panel.table.crossTitle', {
        measure: words.measure(measure),
        by: t(`analytics.byDimension.${by}`),
        across: t(`analytics.byDimension.${across}`),
      }),
      columns: headings,
      lines,
      total: cellsOf((key) => byColumn.get(key), total, read.total.tokens),
      firstSort: 'total',
    }
  }

  /**
   * What the heading row says of the rows (`tableCounts`): the values of this period, counted as
   * the rail's tile counts them; those that spent only before; and the rows of no value that
   * spent now, by name, so the parts add up to the rows shown.
   */
  function countWords(lines: readonly TableLine[]) {
    const { now, before, apart } = tableCounts(lines)
    const names = apart.map((name) => `«${name}»`).join(', ')
    return [
      t('analytics.panel.table.counts.now', { count: now }),
      before ? t('analytics.panel.table.counts.before', { count: before }) : '',
      names ? t('analytics.panel.table.counts.apart', { names }) : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return computed(() => {
    const { cross } = source()
    const model = cross ? crossed(cross.across, cross.usage) : besideBefore()
    return { ...model, counts: countWords(model.lines) }
  })
}

export type TableModel = ReturnType<typeof useTableModel>['value']
