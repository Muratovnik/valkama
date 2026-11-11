/**
 * The breakdown on screen as a CSV file: one row per value, as the table lists them — its id, a
 * task's reference, its name — with what it spent in this period and in the period before, and on
 * every row the bounds of both periods, the dimension and the filters, so the file says what it
 * is of wherever it goes.
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
 *   start — the cell's start, and after a `;`, a `,`, a tab, a carriage return or a line feed —
 *   a formula character (`=`, `+`, `-`, `@`), spaces before it or not, gets a single quote at
 *   that field's start, and a cell that starts with a tab or a carriage return gets one at its
 *   own start; such a cell is then quoted. The quote is part of the text written, so the id
 *   column of such a value is not the id the read gives it;
 * - it starts with a byte order mark, so a spreadsheet reads it as UTF-8 and Cyrillic stands.
 */
import { dayOf, lastDayBefore } from '@/pages/analytics/utils/readMoments.ts'
import { comparedLines, spentAnything } from '@/pages/analytics/utils/usageFigures.ts'
import type { Spent } from '@/pages/analytics/utils/usageFigures.ts'

import { orderFilters } from '@/shared/api/analyticsAddress.ts'
import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type {
  Usage,
  UsageDimension,
  UsageFilters,
  UsageGroupValue,
} from '@/shared/api/analyticsApi.ts'

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
] as const

const BYTE_ORDER_MARK = '\u{FEFF}'
const LINE_END = '\r\n'

/**
 * A field that a spreadsheet would read as a formula: where a field can start under any common
 * separator, spaces, then a formula character. The first group is the field's start.
 */
const FORMULA_FIELD = /(^|[;,\t\r\n])( *[=+\-@])/gu
/** A cell that starts with what a spreadsheet may drop before reading a formula. */
const CONTROL_START = /^[\t\r]/u
const NEEDS_QUOTES = /[",\r\n]/u

/** A text cell as a spreadsheet can only read it as text. */
function text(value: string): string {
  const fields = value.replaceAll(FORMULA_FIELD, "$1'$2")
  const shown = CONTROL_START.test(fields) ? `'${fields}` : fields
  return shown !== value || NEEDS_QUOTES.test(shown) ? `"${shown.replaceAll('"', '""')}"` : shown
}

/** A number as a spreadsheet reads one anywhere: no grouping, a dot, at the read's precision. */
const plain = (value: number, digits: number) => String(Number(value.toFixed(digits)))

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
  /** A value as the page names it. */
  name: (value: UsageGroupValue) => string
}

/**
 * What a value is called apart from its id: a task's title, a project's name, or the page's
 * words for it where the read gives none — «No task», a role's name. Empty where the page names
 * a value by its id alone, as a model.
 */
function nameOf(value: UsageGroupValue, named: string) {
  return value.title ?? value.name ?? (named === value.id ? '' : named)
}

/** The file's text: the byte order mark, the header and a row per value in the table's order. */
export function spendingCsv({ by, filters, measure, usage, name }: CsvSource): string {
  const { comparison } = usage
  const bounds = [
    usage.period.from,
    usage.period.to,
    comparison?.period.from ?? '',
    comparison?.period.to ?? '',
  ]
  const ordered = orderFilters(filters)
  const filterText = Object.keys(ordered).length ? JSON.stringify(ordered) : ''
  const rows = comparedLines({
    rows: usage.rows,
    before: comparison?.rows ?? null,
    dimension: by,
    measure,
    name,
  }).map((line) => {
    const { value } = line
    return [
      text(by),
      text(value.id ?? ''),
      text(value.reference ?? ''),
      text(nameOf(value, name(value))),
      text(line.kind),
      ...figures(line.now),
      ...figures(line.before),
      ...bounds.map((bound) => text(bound)),
      text(filterText),
    ]
  })
  return `${BYTE_ORDER_MARK}${[[...HEADER], ...rows].map((row) => row.join(',')).join(LINE_END)}${LINE_END}`
}

/** What the file is called: the period's first and last day, and the dimension. */
export function csvFileName(usage: Usage, by: UsageDimension): string {
  return `agent-usage-${dayOf(usage.period.from)}-to-${lastDayBefore(usage.period.to)}-by-${by}.csv`
}
