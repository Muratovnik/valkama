/**
 * The arithmetic behind the two chart primitives, kept apart from what draws it so a test can
 * hold every number a reader is shown: a ranked breakdown's order and bar lengths, a stack's
 * segments and scale, which days the time axis names, and where the keyboard goes next.
 *
 * Nothing here formats a value or knows a word. The caller hands both in: a value as the
 * number it is and the text it reads as, and every word as a prop.
 */
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'

function byCodePoint(left: string, right: string) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** A measure as a chart can draw it: a finite amount of zero or more. */
const drawable = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value) && value > 0 ? value : 0

/**
 * What a row of a ranked breakdown is. Three rows are not categories and are never ranked
 * among them: `other` is the folded tail, `none` is work with nothing to file it under (no
 * task) and `unknown` is work the record cannot place.
 */
type RankedRowKind = 'category' | 'other' | 'none' | 'unknown'

export interface RankedRow {
  key: string
  label: string
  value: number
  /** The value as the reader reads it: formatted by the caller, units and all. */
  valueText: string
  /**
   * What pressing the row does, as its accessible name in place of its label: "Show the tasks
   * of opus". The label and the value stay what is drawn; the value describes the control.
   */
  action?: string
  /** Whether pressing the row opens what it names. */
  actionable?: boolean
  /**
   * What the label leaves out, said in its hint: the whole id of a value the label names by
   * the start of it.
   */
  detail?: string
  /**
   * Where the row leads, on this origin: the row is then a link, which a press hands out as
   * `follow` and a modified or middle press takes elsewhere as any link is taken.
   */
  href?: string
  kind?: RankedRowKind
  /**
   * Whether a row ranked among the categories names no value, such as work on no task in a list
   * that ranks it by its figure: its name is then in the quiet ink, slanted, as a note is.
   */
  quiet?: boolean
  /** The hue of a row that names a series drawn elsewhere on the page; slot 1 otherwise. */
  slot?: SeriesSlot
}

export interface PlacedRow extends RankedRow {
  kind: RankedRowKind
  /**
   * The bar's length as a share of the longest category's, from 0 to 1; null for a row that is
   * not a category, which is not drawn on the categories' scale.
   */
  length: number | null
}

export interface RankedWords {
  /** The heading over the table's names. */
  category: string
  empty: string
  /** The heading over the table's values. */
  value: string
  emptyDescription?: string
}

/** The rows that are not categories, in the order they close a breakdown. */
const REST_ORDER: readonly RankedRowKind[] = ['other', 'none', 'unknown']

/**
 * The categories largest first, then the rows that are not categories in a fixed order. A tie
 * keeps one order whatever order the rows came in. A bar is measured against the longest
 * category: the folded tail, work with no task and unknown work sum many values or none, so one
 * of them would set a scale that leaves every category short. They draw no bar (`length` null)
 * and are read by their figures. With `rankAll`, as a section of the Analytics page asks, work
 * with no value and unknown work are ranked and drawn on the categories' scale, and only the
 * folded tail closes the chart.
 */
export function rankRows(
  rows: readonly RankedRow[],
  /** Rank work with no value and unknown work among the categories, by their figures. */
  rankAll = false,
): { ranked: PlacedRow[]; rest: PlacedRow[] } {
  const ranks = (row: RankedRow) =>
    (row.kind ?? 'category') === 'category' || (rankAll && row.kind !== 'other')
  const categories = rows.filter((row) => ranks(row))
  const longest = Math.max(0, ...categories.map((row) => drawable(row.value)))
  const ranked = categories
    .map((row) => ({
      ...row,
      kind: row.kind ?? 'category',
      length: longest ? drawable(row.value) / longest : 0,
    }))
    .sort(
      (left, right) =>
        drawable(right.value) - drawable(left.value) ||
        byCodePoint(left.label, right.label) ||
        byCodePoint(left.key, right.key),
    )
  const rest = REST_ORDER.flatMap((kind) =>
    rows
      .filter((row) => row.kind === kind && !ranks(row))
      .map((row) => ({ ...row, kind, length: null })),
  )
  return { ranked, rest }
}

export interface PeriodSeries {
  key: string
  label: string
  slot: SeriesSlot
}

export interface PeriodColumn {
  key: string
  /** What the time axis prints under the column: short, a day or an hour. */
  label: string
  /** Each series' amount in this period, by series key; a series it lacks is zero. */
  values: Readonly<Partial<Record<string, number>>>
  /**
   * The series that spent in this period without a figure — no price, nothing counted — in
   * whole or in part. Absent is not zero: it draws nothing, reads as a dash where no amount
   * stands, and is said in words beside the period.
   */
  absent?: readonly string[]
  /**
   * What pressing the period does, as its accessible name where periods act: "Show the tasks of
   * Monday, 9 November". What the period holds then describes it.
   */
  action?: string
  /**
   * What the period it is compared with held at this place, drawn as a short mark at that height
   * on the same scale; null where that period has no figure, and undefined where nothing is
   * compared.
   */
  before?: number | null
  /**
   * The period's short name with its month, «Oct 27», and which month that is: the time axis
   * prints it instead of `label` under the first period it names and under the first it names of
   * each later month, so a span across months says which. None where a name needs no month, as
   * an hour's.
   */
  dated?: { label: string; month: string }
  /** The period named in full, for its accessible name and the table; `label` otherwise. */
  fullLabel?: string
  /** A period still running, whose amount is what it holds so far. */
  incomplete?: boolean
  /**
   * A period whose figures are not in yet, such as one after the newest record read: no data,
   * which is not zero. It is drawn as a hatched ground with no sum, and says so in words.
   */
  pending?: boolean
}

/** Something that changed at the start of a period, such as the account the work ran under. */
export interface PeriodMark {
  /** The key of the period it starts. */
  at: string
  label: string
}

export interface PeriodWords {
  empty: string
  /** What a period still running says of itself: "so far". */
  incomplete: string
  /** The heading over the table's notes: what is still running, what changed. */
  note: string
  /** The heading over the table's periods. */
  period: string
  /** The word before a period's sum. */
  total: string
  /** What a series with no figure in a period says before its names: "No price". */
  absent?: string
  /** The words before the figure of the period compared with, and the heading over them. */
  before?: string
  emptyDescription?: string
  /** What a period with no data yet says of itself (`PeriodColumn.pending`): "No data yet". */
  pending?: string
}

/** What a press in a period chart opens: a period, or one series in it. */
/** What `PeriodColumns` and `PeriodColumnsTable` both take: one set of periods, drawn or tabled. */
export interface PeriodChartProps {
  columns: readonly PeriodColumn[]
  /** What the chart shows, as its accessible name and its table's caption. */
  label: string
  /** Bottom of the stack first; give them in the order `seriesSlots()` handed out. */
  series: readonly PeriodSeries[]
  words: PeriodWords
  /** What a press opens, if anything: a whole period, or one series in it. */
  actionable?: 'column' | 'segment' | null
  marks?: readonly PeriodMark[]
  /**
   * The value axis, where its steps are other than round steps said as `formatValue` says a
   * value: a span of time in one unit (`durationAxis`).
   */
  valueAxis?: ValueAxis
  /** A value as the reader reads it, for the scale, the readout, the names and the table. */
  formatValue: (value: number) => string
}

/** A step of a value axis: where it stands, in the chart's units, and what it says. */
export interface AxisStep {
  text: string
  value: number
}

/** The steps of a value axis from zero up to the first one at or past `largest`. */
export type ValueAxis = (largest: number) => AxisStep[]

export interface PeriodSelection {
  column: string
  series: string | null
}

export interface StackSegment {
  end: number
  series: PeriodSeries
  /** Where the segment starts and ends on the value axis, in the measure's own units. */
  start: number
  value: number
}

export interface StackedColumn {
  /** The series with no figure in the period (`PeriodColumn.absent`), in the series' order. */
  absent: PeriodSeries[]
  column: PeriodColumn
  marks: string[]
  /** Bottom first, in the series' order; a series with nothing in the period has no segment. */
  segments: StackSegment[]
  /** The sum drawn; a period with nothing drawn and a series absent has no sum (`hasSum`). */
  total: number
}

/** Whether a period has a sum to say: anything drawn, or nothing absent, which is a real zero. */
export const hasSum = (stacked: StackedColumn) =>
  stacked.segments.length > 0 || stacked.absent.length === 0

/**
 * Round steps from zero up to the first one at or past the largest value: 1, 2, 2.5 or 5 times
 * a power of ten, about four of them. The axis always starts at zero, because a column's height
 * is its amount. Counting `whole` units, a step is a whole number of them, never less than one.
 */
export function valueTicks(largest: number, target = 4, whole = false): number[] {
  if (largest <= 0 || !Number.isFinite(largest)) return [0]
  const rough = whole ? Math.max(1, largest / target) : largest / target
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10]
    .map((factor) => factor * power)
    .find((size) => size >= rough && (!whole || Number.isInteger(size)))
  const size = step ?? 10 * power
  const count = Math.ceil(largest / size - 1e-9)
  return Array.from({ length: count + 1 }, (_, index) => Number((index * size).toPrecision(12)))
}

/** Round steps of a value axis, each said as `format` says a value. */
export const roundAxis =
  (format: (value: number) => string): ValueAxis =>
  (largest) =>
    valueTicks(largest).map((value) => ({ value, text: format(value) }))

/** Each period's stack, and the scale they stand on: round steps unless an axis is given. */
export function stackColumns(
  columns: readonly PeriodColumn[],
  series: readonly PeriodSeries[],
  marks: readonly PeriodMark[] = [],
  axis: ValueAxis = roundAxis(String),
): { columns: StackedColumn[]; steps: AxisStep[]; ticks: number[]; top: number } {
  const stacked = columns.map((column) => {
    const segments: StackSegment[] = []
    let reached = 0
    for (const one of series) {
      const value = drawable(column.values[one.key])
      if (!value) continue
      segments.push({ series: one, value, start: reached, end: reached + value })
      reached += value
    }
    const notes = marks.filter((mark) => mark.at === column.key).map((mark) => mark.label)
    const absent = series.filter((one) => column.absent?.includes(one.key))
    return { column, total: reached, segments, marks: notes, absent }
  })
  // The period compared with stands on the same scale, so its mark is never cut off.
  const before = columns.map((column) => drawable(column.before ?? 0))
  const steps = axis(Math.max(0, ...stacked.map((one) => one.total), ...before))
  const ticks = steps.map((step) => step.value)
  return { columns: stacked, steps, ticks, top: ticks.at(-1) || 1 }
}

/**
 * A segment's place in its stack, as shares of the stack's height, with a 2px gap of ground
 * under every segment but the lowest: neighbours are told apart by the gap, not by a line.
 */
export function segmentPlace(one: StackedColumn, at: number) {
  const segment = one.segments[at]
  if (!segment || one.total <= 0) return { insetBlockEnd: '0%', blockSize: '0%' }
  const start = `${(segment.start / one.total) * 100}%`
  const size = `${(segment.value / one.total) * 100}%`
  if (at === 0) return { insetBlockEnd: start, blockSize: size }
  return {
    insetBlockEnd: `calc(${start} + var(--space-half))`,
    blockSize: `max(0px, calc(${size} - var(--space-half)))`,
  }
}

/** The room one day's label needs on the time axis, and the most labels it ever prints. */
const LABEL_ROOM = 72
const MOST_LABELS = 8

/**
 * Which columns the time axis names, counted back from the last: the period still running is
 * the one a reader looks for, so it is always named, and the rest step evenly behind it. A width
 * not yet measured names the first and the last.
 */
export function labelledColumns(count: number, width: number): number[] {
  if (count <= 0) return []
  if (width <= 0 || !Number.isFinite(width)) return [...new Set([0, count - 1])]
  const room = Math.max(1, Math.min(MOST_LABELS, Math.floor(width / LABEL_ROOM)))
  const step = Math.ceil(count / room)
  return Array.from({ length: count }, (_, index) => index).filter(
    (index) => (count - 1 - index) % step === 0,
  )
}

/** A label set along one edge of a plot, at a share of its length. */
export interface PlacedTick {
  /**
   * Which point of the label stands there. Wherever it stands, a label along an edge keeps inside
   * it, moved in by no more than it would hang past (`ChartTicks`).
   */
  edge: 'end' | 'middle' | 'start'
  key: number | string
  /** Where along the edge, from 0 at its start (or the baseline) to 1 at its end. */
  offset: number
  text: string
  /** A second line under the first: "so far" under a period still running. */
  note?: string
}

/** The narrowest a period's column is drawn, and the widest it grows where its period has room. */
const COLUMN = { least: 24, most: 56 }

/**
 * How wide each period's column is drawn, in pixels, among `count` periods across `width`: half
 * the room of its period, from 24px up to 56px. A few periods across a wide plot stand as broad
 * columns rather than a row of thin lines, and many periods or a narrow plot keep 24px, which the
 * plot draws no wider than the period's room.
 */
export function columnWidth(count: number, width: number): number {
  const half = count && width ? Math.floor(width / count / 2) : 0
  return Math.min(COLUMN.most, Math.max(COLUMN.least, half))
}

/** The least room between two names on the time axis, in pixels: more than a space. */
const LABEL_GAP = 8

/**
 * Where a name of the time axis stands, in pixels from the axis's start: under the middle of its
 * column, moved in only as far as it would hang past either end, as `ChartTicks` places it.
 */
function labelSpan(index: number, count: number, width: number, wide: number) {
  const middle = ((index + 0.5) / count) * width
  const start = Math.max(0, Math.min(middle - wide / 2, width - wide))
  return { start, end: start + wide }
}

/**
 * The time axis: each period it has room to name under the middle of its column, and any still
 * running; the first and the last too, which the axis moves in only as far as their names would
 * hang past the plot. The first name printed, and the first printed of each later month, carry
 * their month (`PeriodColumn.dated`).
 *
 * No two names come closer than `LABEL_GAP`, each as wide as `measure` says its text and its
 * note are: a period still running keeps its name, and a neighbour that would touch it gives
 * way, as does any name that would touch one nearer the end. Without a measure (0 for every
 * text) only names standing in one place would touch.
 */
export function dayTicks(
  columns: readonly PeriodColumn[],
  width: number,
  incomplete: string,
  measure: (text: string) => number = () => 0,
): PlacedTick[] {
  const count = columns.length
  const running = columns.flatMap((column, index) => (column.incomplete ? [index] : []))
  // The running periods first, then the rest from the end back: who gives way is decided here.
  const wanted = [...new Set([...running.reverse(), ...labelledColumns(count, width).reverse()])]
  const kept: { end: number; index: number; start: number }[] = []
  for (const index of wanted) {
    const column = columns[index]
    if (!column) continue
    // Measured at its widest — dated or not — since which name carries the month is known last.
    const wide = Math.max(
      measure(column.label),
      column.dated ? measure(column.dated.label) : 0,
      column.incomplete ? measure(incomplete) : 0,
    )
    const span = labelSpan(index, count, width, wide)
    const clear = kept.every(
      (other) => span.end + LABEL_GAP <= other.start || other.end + LABEL_GAP <= span.start,
    )
    if (clear || width <= 0) kept.push({ index, ...span })
  }
  let month: string | undefined
  return kept
    .map((one) => one.index)
    .sort((left, right) => left - right)
    .flatMap((index) => {
      const column = columns[index]
      if (!column) return []
      const { dated } = column
      const text = dated && dated.month !== month ? dated.label : column.label
      month = dated?.month
      const note = column.incomplete ? { note: incomplete } : {}
      const offset = (index + 0.5) / count
      return [{ key: column.key, text, offset, edge: 'middle' as const, ...note }]
    })
}

type Format = (value: number) => string

const periodName = (stacked: StackedColumn) => stacked.column.fullLabel ?? stacked.column.label

/** What a period holds, in words: its sum, each series in it, and what is said of it. */
export function columnSummary(stacked: StackedColumn, words: PeriodWords, format: Format): string {
  const parts = seriesParts(stacked.segments, format)
  const head = columnHead(stacked, words, format)
  return [
    parts.length ? `${head}; ${parts.join(', ')}` : head,
    ...columnNotes(stacked, words, { withSum: true }),
  ]
    .filter(Boolean)
    .join('. ')
}

/** A period's name and sum, and the period compared with beside the sum. */
function columnHead(stacked: StackedColumn, words: PeriodWords, format: Format) {
  const before = stacked.column.before
  const compared =
    words.before && typeof before === 'number' ? `, ${words.before} ${format(before)}` : ''
  return saysSum(stacked)
    ? `${periodName(stacked)}: ${sumWords(stacked, words, format)}${compared}`
    : `${periodName(stacked)}${compared}`
}

/** Whether words about a period say its sum: it has one, and its figures are in. */
const saysSum = (stacked: StackedColumn) => hasSum(stacked) && !stacked.column.pending

/** A period's sum, «total 3 h», and «so far» after it while the period is still running. */
function sumWords(stacked: StackedColumn, words: PeriodWords, format: Format) {
  const running = stacked.column.incomplete ? ` ${words.incomplete}` : ''
  return `${words.total} ${format(stacked.total)}${running}`
}

const seriesParts = (segments: readonly StackSegment[], format: Format) =>
  segments.map((segment) => `${segment.series.label} ${format(segment.value)}`)

/**
 * A period as the one line of the readout over its chart: its name, sum and the period compared
 * with, what is said of it — such as a change of account at its start — and then each series in
 * it, the largest first, so what a narrow line cuts is the tail of the series.
 */
export function readoutLine(stacked: StackedColumn, words: PeriodWords, format: Format) {
  const largest = [...stacked.segments].sort((left, right) => right.value - left.value)
  const series = seriesParts(largest, format).join(', ')
  return [
    columnHead(stacked, words, format),
    ...columnNotes(stacked, words, { withSum: true }),
    ...(series ? [series] : []),
  ].join('. ')
}

/**
 * The period the readout says while neither the pointer nor the keyboard stands on one: the last
 * period begun, which is the one still running where one is, so a day read by its hours says the
 * hour under way rather than the last hour of the day, still to come; the last period otherwise.
 */
export function lastBegun(columns: readonly StackedColumn[]): number {
  for (let index = columns.length - 1; index >= 0; index -= 1)
    if (columns[index]?.column.incomplete) return index
  return columns.length - 1
}

/** One segment in words, with the sum of the period it stands in. */
export function segmentSummary(
  stacked: StackedColumn,
  segment: StackSegment,
  words: PeriodWords,
  format: Format,
): string {
  const head = `${periodName(stacked)}: ${segment.series.label} ${format(segment.value)}, ${sumWords(stacked, words, format)}`
  return [head, ...columnNotes(stacked, words, { withSum: true })].join('. ')
}

/**
 * What is said of a period besides its numbers: that it is still running, that it has no data
 * yet, which series have no figure in it, what changed. Said `withSum`, after words that say the
 * period's sum (`columnHead`), «so far» stands after that sum and is no note of its own; the
 * table, whose sum has a cell of its own, keeps it among the notes.
 */
export function columnNotes(
  stacked: StackedColumn,
  words: PeriodWords,
  { withSum = false }: { withSum?: boolean } = {},
): string[] {
  const names = stacked.absent.map((one) => one.label).join(', ')
  const absent = names ? [words.absent ? `${words.absent}: ${names}` : names] : []
  const pending = stacked.column.pending && words.pending ? [words.pending] : []
  // A period with no data yet holds nothing «so far»: it says only that it has none.
  const said = withSum && saysSum(stacked)
  const running = stacked.column.incomplete && !pending.length && !said ? [words.incomplete] : []
  return [...running, ...pending, ...absent, ...stacked.marks]
}

/** A place the keyboard can stand on: a column, and in it a segment when segments act. */
export interface ChartCursor {
  column: number
  segment: number | null
}

/**
 * Where an arrow key takes the keyboard. Left and right move between periods; up and down
 * between the segments of one, up being higher in the stack. Moving sideways keeps to the same
 * series where the next period has it. Where segments act, a period with nothing in it has
 * nothing to stand on and is passed over. Null for a key that moves nothing.
 */
export function nextCursor(
  columns: readonly StackedColumn[],
  cursor: ChartCursor,
  key: string,
): ChartCursor | null {
  const bySegment = cursor.segment !== null
  const standable = columns
    .map((one, index) => ({ one, index }))
    .filter(({ one }) => !bySegment || one.segments.length > 0)
  const at = standable.findIndex(({ index }) => index === cursor.column)
  if (at === -1) return null
  const land = (to: number): ChartCursor => {
    const target = standable[Math.min(standable.length - 1, Math.max(0, to))]
    if (!bySegment) return { column: target.index, segment: null }
    const series = columns[cursor.column].segments[cursor.segment ?? 0]?.series.key
    const same = target.one.segments.findIndex((segment) => segment.series.key === series)
    const nearest = Math.min(cursor.segment ?? 0, target.one.segments.length - 1)
    return { column: target.index, segment: same === -1 ? nearest : same }
  }
  if (key === 'ArrowRight') return land(at + 1)
  if (key === 'ArrowLeft') return land(at - 1)
  if (key === 'Home') return land(0)
  if (key === 'End') return land(standable.length - 1)
  if (!bySegment || (key !== 'ArrowUp' && key !== 'ArrowDown')) return null
  const count = columns[cursor.column].segments.length
  const step = key === 'ArrowUp' ? 1 : -1
  return {
    column: cursor.column,
    segment: Math.min(count - 1, Math.max(0, (cursor.segment ?? 0) + step)),
  }
}
