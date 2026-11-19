/**
 * The table on screen as a CSV file, its rows in the order the table shows them.
 *
 * Beside the period before (`spendingCsv`): one row per value — its id, a task's reference, its
 * name — with what it spent in this period and in the period before, and on every row the bounds
 * of both periods, the dimension and the filters, so the file says what it is of wherever it goes;
 * then its tokens of this period by kind. With the section split by a second dimension each row
 * is a pair, and after the cells of its first value stand the second dimension and the cells of
 * its second value, the same four.
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
import { dayOf, lastDayBefore } from '@/pages/analytics/utils/readMoments.ts'
import { kindsByValue, kindsOf, TOKEN_KINDS } from '@/pages/analytics/utils/tokenKinds.ts'
import { comparedLines, spentAnything } from '@/pages/analytics/utils/usageFigures.ts'
import type { Spent } from '@/pages/analytics/utils/usageFigures.ts'
import { valueKind } from '@/pages/analytics/utils/usageValues.ts'

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

/** The columns that say which value a row is of, after the dimension it is of. */
const VALUE_HEADER = ['value_id', 'value_reference', 'value_name', 'value_kind']

/** The same of a pair's second value, after the dimension the section is split by. */
const SPLIT_HEADER = ['split', 'split_id', 'split_reference', 'split_name', 'split_kind']

/** The columns of the figures and of what the file is of. */
const FIGURES_HEADER = [
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

interface CsvSource {
  by: UsageDimension
  /** The filters the answer was read with, its scope's project among them. */
  filters: UsageFilters
  measure: Measure
  usage: Usage
  /** The second dimension the section is split by; `usage` is then the read by `by` and it. */
  across?: UsageDimension | null
  /** The keys of the values in the order the table shows them; the read's own order otherwise. */
  order?: readonly string[]
  /** A value of a dimension, the section's where none is said, as the page names it. */
  name: (value: UsageGroupValue, dimension?: UsageDimension) => string
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
 * What a value is called: a task's title, a project's name, or the page's words for it where the
 * read gives none — «No task», a role's name, a model by its id, as the page shows it. A script
 * reading the file finds every value's name in the one column, whatever the dimension: left
 * empty where the page names a value by its id, a model's row had no name at all.
 */
function nameOf(value: UsageGroupValue, named: string) {
  return value.title ?? value.name ?? named
}

/** The cells that say which value a row is of: its id, reference, name and kind. */
const valueCells = (value: UsageGroupValue, kind: string, named: string) => [
  text(value.id ?? ''),
  text(value.reference ?? ''),
  text(nameOf(value, named)),
  text(kind),
]

/**
 * The file beside the period before: the header and a row per value, or per pair while split, in
 * the table's order.
 */
export function spendingCsv(source: CsvSource): string {
  const { by, across = null, filters, measure, usage, name, order } = source
  const { comparison } = usage
  const bounds = [
    usage.period.from,
    usage.period.to,
    comparison?.period.from ?? '',
    comparison?.period.to ?? '',
  ]
  const kinds = kindsByValue(usage.rows, by, across)
  const lines = comparedLines({
    rows: usage.rows,
    before: comparison?.rows ?? null,
    dimension: by,
    measure,
    name: (value) => name(value, by),
    across,
  })
  const header = ['breakdown', ...VALUE_HEADER, ...(across ? SPLIT_HEADER : []), ...FIGURES_HEADER]
  const rows = ordered(lines, order).map((line) => {
    const tokens = kindsOf(kinds, line.key)
    const second = line.second
    return [
      text(by),
      ...valueCells(line.value, valueKind(line.value), name(line.value, by)),
      ...(second
        ? [
            text(second.dimension),
            ...valueCells(
              second.value,
              valueKind(second.value),
              name(second.value, second.dimension),
            ),
          ]
        : []),
      ...figures(line.now),
      ...figures(line.before),
      ...bounds.map((bound) => text(bound)),
      filterCell(filters),
      ...TOKEN_KINDS.map((kind) => count(tokens[kind])),
    ]
  })
  return fileOf([header, ...rows])
}

/** What the file is called: the period's first and last day, and the dimension or the two. */
export function csvFileName(
  usage: Usage,
  by: UsageDimension,
  across?: UsageDimension | null,
): string {
  const of = across ? `${by}-and-${across}` : by
  return `agent-usage-${dayOf(usage.period.from)}-to-${lastDayBefore(usage.period.to)}-by-${of}.csv`
}

/** The file of the table on show, and its name: of its pairs while split, of its values else. */
export function tableFile(source: CsvSource) {
  return { name: csvFileName(source.usage, source.by, source.across), text: spendingCsv(source) }
}
