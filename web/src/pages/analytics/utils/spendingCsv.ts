/**
 * The table on screen as a CSV file, its rows in the order the table shows them.
 *
 * Beside the period before (`spendingCsv`): one row per value — its id, a task's reference, its
 * name — with what it spent in this period and in the period before, and on every row the bounds
 * of both periods, the dimension and the filters, so the file says what it is of wherever it goes;
 * then its tokens of this period by kind. Crossed with a second dimension (`crossCsv`): one row
 * per value of the section's dimension, a column per column of the table in the chosen measure,
 * its total, its tokens by kind when the measure is tokens, and the bounds and the filters.
 *
 * The file is for a spreadsheet, which takes what it reads literally:
 * - numbers are plain — no thousands separator, a dot before the decimals — in seconds, tokens
 *   and US dollars; a figure the read does not hold is an empty cell and never a zero, while a
 *   value that spent nothing in a period is a zero there;
 * - a text cell is quoted when it holds a comma, a quote or a line break (RFC 4180), with its
 *   quotes doubled, and the lines end in CRLF;
 * - a formula in a text cell is shown rather than run, whichever separator the spreadsheet
 *   splits the file on: task titles are other people's text, and a spreadsheet set to split on
 *   `;` or a tab makes a field of every stretch between them, quoted or not. Wherever a field can
 *   start — the cell's start, and after a `;`, a tab, a carriage return or a line feed — a
 *   formula character (`=`, `+`, `-`, `@`), spaces before it or not, gets a single quote at that
 *   field's start, and a cell that starts with a tab or a carriage return gets one at its own
 *   start; such a cell is then quoted. Inside a cell a quotation mark may stand before the
 *   formula character as well: there it would open the field and be dropped. A comma starts no
 *   field: a cell that holds one is quoted, and a spreadsheet that splits on commas keeps a
 *   quoted cell whole, so «a, -b» stays as written. The quote is part of the text written, so
 *   the id column of such a value is not the id the read gives it;
 * - it starts with a byte order mark, so a spreadsheet reads it as UTF-8 and Cyrillic stands.
 */
import { crossOf } from '@/pages/analytics/utils/crossFigures.ts'
import { dayOf, lastDayBefore } from '@/pages/analytics/utils/readMoments.ts'
import { kindsByValue, kindsOf, TOKEN_KINDS } from '@/pages/analytics/utils/tokenKinds.ts'
import { comparedLines, spentAnything } from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine, Spent } from '@/pages/analytics/utils/usageFigures.ts'

import { orderFilters } from '@/shared/api/analyticsAddress.ts'
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type {
  Usage,
  UsageDimension,
  UsageFilters,
  UsageGroupValue,
} from '@/shared/api/analyticsApi.ts'

/** The columns of each kind of token, by the names a script reading the file finds them by. */
const KIND_HEADER = TOKEN_KINDS.map((kind) => `${kind}_tokens`)

/** The columns, by the names a script reading the file finds them by. */
const HEADER = [
  'breakdown',
  'value_id',
  'value_reference',
  'value_name',
  'value_kind',
  'time_seconds',
  'tokens',
  'cost_usd',
  'unpriced_tokens',
  'before_time_seconds',
  'before_tokens',
  'before_cost_usd',
  'before_unpriced_tokens',
  'period_from',
  'period_to',
  'before_from',
  'before_to',
  'filters',
  ...KIND_HEADER,
]

/** What a crossed file's figures are, by the unit they are in. */
const MEASURE_UNITS = { time: 'time_seconds', tokens: 'tokens', cost: 'cost_usd' } as const

const BYTE_ORDER_MARK = '\u{FEFF}'
const LINE_END = '\r\n'

/** A cell that a spreadsheet would read as a formula: spaces, then a formula character. */
const FORMULA_CELL = /^ *[=+\-@]/u
/**
 * A field inside a cell that a spreadsheet splitting on another separator would read as a
 * formula: the separator, then spaces or the quotation marks that would only open the field,
 * then a formula character. The first group is the separator.
 */
const FORMULA_FIELD = /([;\t\r\n])([ "]*[=+\-@])/gu
/** A cell that starts with what a spreadsheet may drop before reading a formula. */
const CONTROL_START = /^[\t\r]/u
const NEEDS_QUOTES = /[",\r\n]/u

/** A text cell as a spreadsheet can only read it as text. */
function text(value: string): string {
  const fields = value.replaceAll(FORMULA_FIELD, "$1'$2")
  const shown = FORMULA_CELL.test(fields) || CONTROL_START.test(fields) ? `'${fields}` : fields
  return shown !== value || NEEDS_QUOTES.test(shown) ? `"${shown.replaceAll('"', '""')}"` : shown
}

/** A number as a spreadsheet reads one anywhere: no grouping, a dot, at the read's precision. */
const plain = (value: number, digits: number) => String(Number(value.toFixed(digits)))

/** A count the read may not report: empty when it does not. */
const count = (value: number | null) => (value === null ? '' : String(value))

/**
 * A period's four figures: seconds, tokens, dollars and the tokens with no price. A figure the
 * read does not hold is empty; a period the value spent nothing in reads as zeros; a period
 * that was not read is empty throughout.
 */
function figures(spent: Spent | null): string[] {
  if (!spent) return ['', '', '', '']
  const held = (amount: number | null, digits: number) => {
    if (amount !== null) return plain(amount, digits)
    return spentAnything(spent) ? '' : '0'
  }
  return [
    plain(spent.seconds, 3),
    held(spent.tokens, 0),
    held(spent.cost, 6),
    String(spent.unpriced),
  ]
}

/** One measure's figure, in its unit, by the rule `figures` holds every figure to. */
function amount(measure: Measure, spent: Spent): string {
  const [seconds = '', tokens = '', cost = ''] = figures(spent)
  return { time: seconds, tokens, cost }[measure]
}

const NOTHING: Spent = { seconds: 0, tokens: null, cost: null, unpriced: 0 }

interface CsvSource {
  by: UsageDimension
  /** The filters the answer was read with, its scope's project among them. */
  filters: UsageFilters
  measure: Measure
  usage: Usage
  /** The keys of the values in the order the table shows them; the read's own order otherwise. */
  order?: readonly string[]
  /** A value as the page names it. */
  name: (value: UsageGroupValue) => string
}

/** Items in the order their keys stand in `order`, any other after them as they came. */
function ordered<Item extends { key: string }>(items: readonly Item[], order?: readonly string[]) {
  if (!order) return items
  const place = new Map(order.map((key, index) => [key, index]))
  const at = (item: Item) => place.get(item.key) ?? order.length
  return [...items].sort((left, right) => at(left) - at(right))
}

/** The filters as one cell: the chosen ones in one order, empty for none. */
function filterCell(filters: UsageFilters) {
  const chosen = orderFilters(filters)
  return text(Object.keys(chosen).length ? JSON.stringify(chosen) : '')
}

/** The file's text: the byte order mark, then each row, each line ending in CRLF. */
const fileOf = (rows: readonly (readonly string[])[]) =>
  `${BYTE_ORDER_MARK}${rows.map((row) => row.join(',')).join(LINE_END)}${LINE_END}`

/**
 * What a value is called apart from its id: a task's title, a project's name, or the page's
 * words for it where the read gives none — «No task», a role's name. Empty where the page names
 * a value by its id alone, as a model.
 */
function nameOf(value: UsageGroupValue, named: string) {
  return value.title ?? value.name ?? (named === value.id ? '' : named)
}

/** The cells that say which value a row is of: its id, reference, name and kind. */
const valueCells = (value: UsageGroupValue, kind: string, named: string) => [
  text(value.id ?? ''),
  text(value.reference ?? ''),
  text(nameOf(value, named)),
  text(kind),
]

/** The file beside the period before: the header and a row per value, in the table's order. */
export function spendingCsv({ by, filters, measure, usage, name, order }: CsvSource): string {
  const { comparison } = usage
  const bounds = [
    usage.period.from,
    usage.period.to,
    comparison?.period.from ?? '',
    comparison?.period.to ?? '',
  ]
  const kinds = kindsByValue(usage.rows, by)
  const lines = comparedLines({
    rows: usage.rows,
    before: comparison?.rows ?? null,
    dimension: by,
    measure,
    name,
  })
  const rows = ordered(lines, order).map((line) => {
    const tokens = kindsOf(kinds, line.key)
    return [
      text(by),
      ...valueCells(line.value, line.kind, name(line.value)),
      ...figures(line.now),
      ...figures(line.before),
      ...bounds.map((bound) => text(bound)),
      filterCell(filters),
      ...TOKEN_KINDS.map((kind) => count(tokens[kind])),
    ]
  })
  return fileOf([HEADER, ...rows])
}

interface CrossCsvSource extends CsvSource {
  /** The second dimension; `usage` is then the read by `by` and it. */
  across: UsageDimension
  /** A column of the table as the page names it. */
  column: (line: SpendingLine) => string
}

/**
 * The crossed table as a file: a row per value of `by` with its figure in the chosen measure in
 * each column the table shows, under the column's name, then its total; with the measure tokens,
 * its tokens by kind after them.
 */
function crossCsv(source: CrossCsvSource): string {
  const { by, across, filters, measure, usage, name, column, order } = source
  const { columns, rows } = crossOf(usage, by, across, measure)
  const kinds = measure === 'tokens' ? kindsByValue(usage.rows, by) : null
  const header = [
    'breakdown',
    'across',
    'measure',
    'value_id',
    'value_reference',
    'value_name',
    'value_kind',
    ...columns.map((line) => text(column(line))),
    'total',
    ...(kinds ? KIND_HEADER : []),
    'period_from',
    'period_to',
    'filters',
  ]
  const lines = ordered(rows, order).map((row) => {
    const tokens = kinds ? kindsOf(kinds, row.key) : null
    return [
      text(by),
      text(across),
      MEASURE_UNITS[measure],
      ...valueCells(row.value, row.kind, name(row.value)),
      ...columns.map((line) => amount(measure, row.cells.get(line.key) ?? NOTHING)),
      amount(measure, row.total),
      ...(tokens ? TOKEN_KINDS.map((kind) => count(tokens[kind])) : []),
      text(usage.period.from),
      text(usage.period.to),
      filterCell(filters),
    ]
  })
  return fileOf([header, ...lines])
}

/** What the file is called: the period's first and last day, and the dimension or the two. */
export function csvFileName(usage: Usage, by: UsageDimension, across?: UsageDimension): string {
  const of = across ? `${by}-and-${across}` : by
  return `agent-usage-${dayOf(usage.period.from)}-to-${lastDayBefore(usage.period.to)}-by-${of}.csv`
}

interface TableFileSource extends CsvSource {
  /** The second dimension and the read by both, while the table is crossed; null otherwise. */
  cross: { across: UsageDimension; usage: Usage } | null
  /** A column of a crossed table, a value of the second dimension, as the page names it. */
  column: (across: UsageDimension, line: SpendingLine) => string
}

/** The file of the table on show, and its name: crossed while it is, beside the period before else. */
export function tableFile({ cross, column, ...source }: TableFileSource) {
  const text = cross
    ? crossCsv({
        ...source,
        across: cross.across,
        usage: cross.usage,
        column: (line) => column(cross.across, line),
      })
    : spendingCsv(source)
  return { name: csvFileName(source.usage, source.by, cross?.across), text }
}
