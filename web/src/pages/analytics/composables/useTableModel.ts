/**
 * What the table of a dimension's panel holds, as words and numbers to sort by: every value of
 * either period, none folded, with its three measures now, the chosen one before and its change
 * (`comparedLines`), as the page has always tabled it. With the section split by a second
 * dimension each row is a pair, «claude-opus-5-5 · high», a value of the table as any other, read
 * from the answer by both.
 *
 * With the measure «tokens» it adds the tokens of each value by kind (`kindsByValue`), so what the
 * tiles say of the kinds stands value by value. Under the rows is the total of every column, from
 * the read's own total, and for rows a search kept, their own total (`totalOf`). A cell carries the number it sorts by: the figure in its measure, null
 * where the read holds none, which sorts after every figure whichever way the column runs.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { FigureWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import {
  kindsByValue,
  kindsOf,
  kindsTogether,
  TOKEN_KINDS,
} from '@/pages/analytics/utils/tokenKinds.ts'
import type { TokenKind } from '@/pages/analytics/utils/tokenKinds.ts'
import {
  changeOf,
  comparedLines,
  figureOf,
  measureOf,
  spentAnything,
  spentOf,
  spentTogether,
} from '@/pages/analytics/utils/usageFigures.ts'
import type { LineChange, SpendingLine, Spent } from '@/pages/analytics/utils/usageFigures.ts'

import { MEASURES } from '@/shared/api/analyticsAddress.ts'
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageGroupValue } from '@/shared/api/analyticsApi.ts'
import type { UsageTokens } from '@/shared/api/planningUsageApi.ts'
import type { TextRun } from '@/shared/ui/textRuns.ts'

/** A cell's figure and what it leaves out (`FigureWords`), which the cell says under it. */
export interface TableCell extends FigureWords {
  /** Whether the cell holds the chosen measure, which reads in the figures' own ink. */
  chosen: boolean
  key: string
  /** The number the column sorts by; null for no figure. */
  sort: number | null
}

/** A column's heading: its name, which its hint says whole while the heading cuts it. */
interface TableColumn {
  /** Whether the column holds the chosen measure, which reads in the figures' own ink. */
  chosen: boolean
  key: string
  text: string
}

export interface TableLine {
  cells: TableCell[]
  key: string
  name: string
  /** Whether the line is no value of the dimension: work with no value there, or unknown. */
  rest: boolean
  /** The value of the section's dimension, the first of a pair, which pressing the name acts on. */
  value: UsageGroupValue
  /** That value's own name, which a pair's name begins with and an action on the value says. */
  valueName: string
  /**
   * When the line spent: in this period with a figure above zero in the measure; in this period
   * but nothing there (`elsewhere`: the adviser's tokens are no agent time, work with no price is
   * none under the cost); only in the period before; or in neither.
   */
  when: 'before' | 'elsewhere' | 'neither' | 'now'
  detail?: string
  /** The end of a pair's name that stays whole while the rest is cut (`PairName`). */
  nameEnd?: string
  /** The name in runs, where it holds a task's title (`pairRuns`): its code is drawn as code. */
  nameRuns?: readonly TextRun[]
}

/** What the rows of a table are, as its heading row counts them. */
export interface TableCounts {
  /** The names of the rows of no value of the dimension that spent in this period. */
  apart: string[]
  /** Rows that spent only in the period before. */
  before: number
  /** Values of the dimension that spent in this period, but nothing in the measure. */
  elsewhere: number
  /** Values of the dimension with a figure above zero in the measure, as the rail's tile counts them. */
  now: number
}

/**
 * How many rows of a table are values of this period in the measure, how many spent in it only
 * in another measure and how many only before, and which rows of no value spent in this period:
 * together, every row that spent anything.
 */
export function tableCounts(lines: readonly TableLine[]): TableCounts {
  const values = (when: TableLine['when']) =>
    lines.filter((line) => !line.rest && line.when === when).length
  return {
    now: values('now'),
    elsewhere: values('elsewhere'),
    before: lines.filter((line) => line.when === 'before').length,
    apart: lines
      .filter((line) => line.rest && (line.when === 'now' || line.when === 'elsewhere'))
      .map((line) => line.name),
  }
}

/** When a line spent, from what it spent now, in the measure and at all, and, where read, before. */
function whenOf(measure: Measure, now: Spent, before: Spent | null): TableLine['when'] {
  if ((measureOf(measure, now) ?? 0) > 0) return 'now'
  if (spentAnything(now)) return 'elsewhere'
  return before && spentAnything(before) ? 'before' : 'neither'
}

/**
 * Where the table's figures come from: the answer on show, or with a split the answer by both
 * dimensions and the dimension it is split by.
 */
export interface TableSource {
  by: UsageDimension
  measure: Measure
  usage: Usage
  across?: UsageDimension | null
}

/** A kind the read does not report is absent, not zero. */
const ABSENT = '—'

/**
 * How a change sorts: by its share; from nothing as the largest rise; with no figure, or none
 * known, never.
 */
function changeRank(change: LineChange | null): number | null {
  if (!change) return null
  if (change.direction === 'none') return Number.POSITIVE_INFINITY
  return change.direction === 'absent' || change.direction === 'unplaced' ? null : change.ratio
}

export function useTableModel(source: () => TableSource) {
  const { t } = useI18n()
  const words = useSpendingWords()

  const figureCell = (key: string, measure: Measure, spent: Spent, chosen: boolean) => ({
    key,
    chosen,
    ...words.lineFigureWords(measure, spent),
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
            remark: '',
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

  /** A line of the table, a value or a pair, and when it spent (`whenOf`). */
  const lineOf = (
    line: { key: string; kind: string; value: UsageGroupValue; second?: SpendingLine['second'] },
    [cells, when]: [TableCell[], TableLine['when']],
  ): TableLine => {
    const { by } = source()
    return {
      key: line.key,
      value: line.value,
      cells,
      when,
      rest: line.kind !== 'category',
      name: words.pairLabel(by, line.value, line.second),
      nameEnd: words.pairEnd(line.second) || undefined,
      nameRuns: words.pairRuns(by, line.value, line.second),
      valueName: words.valueLabel(by, line.value),
      detail: words.valueDetail(by, line.value),
    }
  }

  /** The three measures, the chosen one before and its change, of each value or pair. */
  function besideBefore() {
    const { by, measure, usage, across = null } = source()
    const { comparison } = usage
    const period = comparison ? words.period(comparison.period.from, comparison.period.to) : ''
    const kinds = kindsByValue(usage.rows, by, across)
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
    // A value's change is its line's (`comparedLines`); the total's, the tiles' own rule.
    const cellsOf = (
      now: Spent,
      before: Spent | null,
      tokens: UsageTokens,
      change: LineChange | null = before ? changeOf(measure, now, before) : null,
    ): TableCell[] => {
      return [
        ...MEASURES.map((key) => figureCell(key, key, now, key === measure)),
        ...(before && change
          ? [
              figureCell('before', measure, before, true),
              {
                key: 'change',
                chosen: false,
                ...words.lineChangeWords(measure, change, now, before),
                sort: changeRank(change),
              },
            ]
          : []),
        ...kindCells(tokens),
      ]
    }
    const compared = comparedLines({
      rows: usage.rows,
      before: comparison?.rows ?? null,
      dimension: by,
      measure,
      name: (value) => words.valueLabel(by, value),
      across,
    })
    const lines = compared.map((line) =>
      lineOf(line, [
        cellsOf(line.now, line.before, kindsOf(kinds, line.key), line.change),
        whenOf(measure, line.now, line.before),
      ]),
    )
    const total = cellsOf(
      spentOf(usage.total),
      comparison ? spentOf(comparison.total) : null,
      usage.total.tokens,
    )
    /** The total of the rows whose keys are given, column by column, as `total` is the period's. */
    const totalOf = (keys: readonly string[]) => {
      const held = new Set(keys)
      const found = compared.filter((line) => held.has(line.key))
      return cellsOf(
        spentTogether(found.map((line) => line.now)),
        comparison
          ? spentTogether(found.flatMap((line) => (line.before ? [line.before] : [])))
          : null,
        kindsTogether(kinds, [...held]),
      )
    }
    // The period compared with is named in its column's heading, so the title need not say it.
    const title = across
      ? t('analytics.table.crossTitle', {
          by: t(`analytics.byDimension.${by}`),
          across: t(`analytics.byDimension.${across}`),
        })
      : t('analytics.table.title', { by: t(`analytics.byDimension.${by}`) })
    return { title, columns, lines, total, totalOf, firstSort: measure as string }
  }

  /**
   * What the heading row says of the rows (`tableCounts`): the values of this period, counted as
   * the rail's tile counts them; those that spent in it nothing in the measure; those that spent
   * only before; and the rows of no value that spent now, by name, so the parts add up to the
   * rows shown.
   */
  function countWords(lines: readonly TableLine[]) {
    const { measure } = source()
    const { now, elsewhere, before, apart } = tableCounts(lines)
    const names = apart.map((name) => `«${name}»`).join(', ')
    return [
      t('analytics.panel.table.counts.now', { count: now }),
      elsewhere ? t(`analytics.panel.table.counts.elsewhere.${measure}`, { count: elsewhere }) : '',
      before ? t('analytics.panel.table.counts.before', { count: before }) : '',
      names ? t('analytics.panel.table.counts.apart', { names }) : '',
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return computed(() => {
    const model = besideBefore()
    return { ...model, counts: countWords(model.lines) }
  })
}

export type TableModel = ReturnType<typeof useTableModel>['value']
