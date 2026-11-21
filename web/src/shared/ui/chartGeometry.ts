/**
 * The arithmetic behind the two chart primitives, kept apart from what draws it so a test can
 * hold every number a reader is shown: a ranked breakdown's order and bar lengths, a stack's
 * segments and scale, which days the time axis names, and where the keyboard goes next.
 *
 * Nothing here formats a value or knows a word. The caller hands both in: a value as the
 * number it is and the text it reads as, and every word as a prop.
 */
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type { TextRun } from '@/shared/ui/textRuns.ts'

/**
 * What stands between a table's figure and the remark under it, where they are said as one: for
 * a screen reader in the cell, unseen, and in the words of a line or a hint.
 */
export const REMARK_JOINT = ', '

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

/**
 * What pressing a mark of a chart does, the same as its row of the table: where it leads, or what
 * it opens. A mark with neither only shows: its hint says what it holds and a press does nothing.
 */
export interface MarkAction {
  /**
   * What pressing the mark does, as its accessible name in place of its label: "Show the tasks
   * of opus". The label and the figures stay what is drawn; they describe the control.
   */
  action?: string
  /** Whether pressing the mark opens what it names. */
  actionable?: boolean
  /**
   * Whether `action` names a part of the label only, as a pair acts as its first value: the mark
   * is then described by its whole label before its figures. Two pairs of one value share one
   * action, and described by their figures alone the screen reader told them apart by nothing.
   */
  actsOnPart?: boolean
  /**
   * Where the mark leads, on this origin: the mark is then a link, which a press hands out as
   * `follow` and a modified or middle press takes elsewhere as any link is taken.
   */
  href?: string
}

/**
 * The id of a part of a mark, its words or its figure, that names or describes it: under the
 * chart's own id, by the mark's key with no white space in it, since a key is a value's id as the
 * read gives it and `aria-describedby` splits its list at white space.
 */
export const markPartId = (chart: string, key: string, part: string) =>
  `${chart}-${encodeURIComponent(key)}-${part}`

/** The type of the element `markTag` draws: a button's, where the mark is not a link. */
export const markType = (mark: MarkAction) => (mark.href ? undefined : 'button')

/** The element a mark is drawn as: a link where it leads, a button where it opens, else `shown`. */
export function markTag<T extends string>(mark: MarkAction, shown: T): 'a' | 'button' | T {
  if (mark.href) return 'a'
  return mark.actionable ? 'button' : shown
}

/** Whether a press on the mark does anything. */
export const markActs = (mark: MarkAction) => Boolean(mark.href) || mark.actionable === true

export interface RankedRow extends MarkAction {
  key: string
  label: string
  value: number
  /** The value as the reader reads it: formatted by the caller, units and all. */
  valueText: string
  /**
   * What the label leaves out, said in its hint: the client and the start of the id of a session
   * the label names by its title.
   */
  detail?: string
  kind?: RankedRowKind
  /** The end of a label of two parts that stays whole while the rest is cut (`PairName`). */
  labelEnd?: string
  /**
   * The label as the runs it is drawn in, where it holds a work item's title (`titleRuns`): its
   * code is drawn as code, in the row, its table and its hint. `writtenText` of them is `label`;
   * without them the label is drawn as the text it is.
   */
  labelRuns?: readonly TextRun[]
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
   * The bar's length as a share of the longest bar's, from 0 to 1; null for a row that is not a
   * category and draws no bar (`rankRows`).
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
 * folded tail closes the chart. With `drawApart`, as a list of values named by free text asks,
 * all three close the chart unranked and each draws its bar, on one scale with the categories
 * that the longest of every row sets: work on no task can be the largest part of a period, and
 * a bar shows that where a figure among short ones does not.
 */
export function rankRows(
  rows: readonly RankedRow[],
  /** Rank work with no value and unknown work among the categories, by their figures. */
  rankAll = false,
  /** Close the chart with every row that is not a category, each with its bar on one scale. */
  drawApart = false,
): { ranked: PlacedRow[]; rest: PlacedRow[] } {
  const ranks = (row: RankedRow) =>
    (row.kind ?? 'category') === 'category' || (rankAll && !drawApart && row.kind !== 'other')
  const categories = rows.filter((row) => ranks(row))
  const longest = Math.max(0, ...(drawApart ? rows : categories).map((row) => drawable(row.value)))
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
  const apartLength = (row: RankedRow) => {
    if (!drawApart) return null
    return longest ? drawable(row.value) / longest : 0
  }
  const rest = REST_ORDER.flatMap((kind) =>
    rows
      .filter((row) => row.kind === kind && !ranks(row))
      .map((row) => ({ ...row, kind, length: apartLength(row) })),
  )
  return { ranked, rest }
}

/** A series of a chart of periods; pressing its segment or its legend entry does `MarkAction`. */
export interface PeriodSeries extends MarkAction {
  key: string
  label: string
  slot: SeriesSlot
  /** The end of a pair's `label` that stays whole while the rest gives way (`PairName`). */
  labelEnd?: string
  /** The label as the runs it is drawn in, where it holds a work item's title (`RankedRow`). */
  labelRuns?: readonly TextRun[]
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
  /**
   * The keys of `values` this period does not name: a series whose amount here says nothing of
   * how much, as its caller judges it, or an amount no series stands for. Such an amount is not
   * drawn, and the period's hint and its table row say of a series what they say of one with
   * nothing there, while the period's sum, and the series' figure over the span, count it.
   */
  unnamed?: readonly string[]
}

/** Something that changed at the start of a period, such as the account the work ran under. */
export interface PeriodMark {
  /** The key of the period it starts. */
  at: string
  label: string
}

export interface PeriodWords {
  empty: string
  /**
   * What the legend calls the hatch a period still running is drawn with, beside a hatched
   * swatch while such a period is on the plot: "in progress".
   */
  hatch: string
  /**
   * What a period still running says of itself, in its hint, its name and its row of the
   * table: no word stands under its name on the axis, where it is hatched instead.
   */
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
  /**
   * What the legend calls the line a change at a period's start is drawn as (`PeriodMark`),
   * beside a short upright line while the plot marks one: "account change".
   */
  change?: string
  emptyDescription?: string
  /** What a period with no data yet says of itself (`PeriodColumn.pending`): "No data yet". */
  pending?: string
}

/**
 * What `PeriodColumns` and `PeriodColumnsTable` both take: one set of periods, drawn or tabled. A
 * period acts where it names its `action`, and a series where it says what pressing it does
 * (`MarkAction`); the rest only show.
 */
export interface PeriodChartProps {
  columns: readonly PeriodColumn[]
  /** What the chart shows, as its accessible name and its table's caption. */
  label: string
  /** Bottom of the stack first; give them in the order `seriesSlots()` handed out. */
  series: readonly PeriodSeries[]
  words: PeriodWords
  marks?: readonly PeriodMark[]
  /**
   * The value axis, where its steps are other than round steps said as `formatValue` says a
   * value: a span of time in one unit (`durationAxis`).
   */
  valueAxis?: ValueAxis
  /**
   * A share as bare as a column of shares prints it, «42 %»: a period's hint draws each series'
   * share in a column of its own (`periodHint`), where what it is a share of goes without saying.
   * Without it that column is absent. The words of the hint, which assistive technology reads,
   * keep `formatShare`, and so does a legend entry's hint.
   */
  formatPart?: (ratio: number) => string
  /** A share of a whole as the reader reads it, for the hints: «42 % of the total». */
  formatShare?: (ratio: number) => string
  /** A value as the reader reads it, for the scale, the hints, the names and the table. */
  formatValue: (value: number) => string
}

/** A step of a value axis: where it stands, in the chart's units, and what it says. */
export interface AxisStep {
  text: string
  value: number
}

/** The steps of a value axis from zero up to the first one at or past `largest`. */
export type ValueAxis = (largest: number) => AxisStep[]

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
  /** How high the stack is drawn: its segments together. */
  drawn: number
  marks: string[]
  /**
   * Bottom first, in the series' order; a series with nothing in the period, or with an amount
   * there it does not name (`PeriodColumn.unnamed`), has no segment.
   */
  segments: StackSegment[]
  /**
   * The period's sum: what is drawn and what is not named; a period with nothing drawn and a
   * series absent has no sum (`hasSum`).
   */
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
      if (!value || column.unnamed?.includes(one.key)) continue
      segments.push({ series: one, value, start: reached, end: reached + value })
      reached += value
    }
    const unnamed = (column.unnamed ?? []).reduce(
      (sum, key) => sum + drawable(column.values[key]),
      0,
    )
    const notes = marks.filter((mark) => mark.at === column.key).map((mark) => mark.label)
    const absent = series.filter((one) => column.absent?.includes(one.key))
    return { column, drawn: reached, total: reached + unnamed, segments, marks: notes, absent }
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
  if (!segment || one.drawn <= 0) return { insetBlockEnd: '0%', blockSize: '0%' }
  const start = `${(segment.start / one.drawn) * 100}%`
  const size = `${(segment.value / one.drawn) * 100}%`
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
 * No two names come closer than `LABEL_GAP`, each as wide as `measure` says its text is: a
 * period still running keeps its name, and a neighbour that would touch it gives way, as does
 * any name that would touch one nearer the end. Without a measure (0 for every text) only
 * names standing in one place would touch.
 */
export function dayTicks(
  columns: readonly PeriodColumn[],
  width: number,
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
    const wide = Math.max(measure(column.label), column.dated ? measure(column.dated.label) : 0)
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
      const offset = (index + 0.5) / count
      return [{ key: column.key, text, offset, edge: 'middle' as const }]
    })
}

type Format = (value: number) => string

/** A part's share of its whole in words (`formatShare`), or nothing where none can be said. */
export function shareWords(
  value: number,
  whole: number,
  share: ((ratio: number) => string) | undefined,
): string {
  return share && whole > 0 && Number.isFinite(value) ? share(Math.max(0, value) / whole) : ''
}

/** A period named in full, as its accessible name and its hint name it. */
export const periodName = (stacked: StackedColumn) =>
  stacked.column.fullLabel ?? stacked.column.label

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
export function columnHead(stacked: StackedColumn, words: PeriodWords, format: Format) {
  const before = stacked.column.before
  const compared =
    words.before && typeof before === 'number' ? `, ${words.before} ${format(before)}` : ''
  return saysSum(stacked)
    ? `${periodName(stacked)}: ${sumWords(stacked, words, format)}${compared}`
    : `${periodName(stacked)}${compared}`
}

/** Whether words about a period say its sum: it has one, and its figures are in. */
export const saysSum = (stacked: StackedColumn) => hasSum(stacked) && !stacked.column.pending

/** A period's sum, «total 3 h», and «so far» after it while the period is still running. */
function sumWords(stacked: StackedColumn, words: PeriodWords, format: Format) {
  const running = stacked.column.incomplete ? ` ${words.incomplete}` : ''
  return `${words.total} ${format(stacked.total)}${running}`
}

/** A segment as its series and its figure, «opus 2 h», and after a comma what `more` says. */
function seriesPart(segment: StackSegment, format: Format, more = '') {
  const figure = `${segment.series.label} ${format(segment.value)}`
  return more ? `${figure}, ${more}` : figure
}

/** Each segment as its series and its figure, «opus 2 h», with what `more` says of each. */
export const seriesParts = (
  segments: readonly StackSegment[],
  format: Format,
  more?: (segment: StackSegment) => string,
) => segments.map((segment) => seriesPart(segment, format, more?.(segment)))

/**
 * One segment in words: its figure, its share of the period where the chart says how a share
 * reads, and the sum of the period it stands in.
 */
export function segmentSummary(
  stacked: StackedColumn,
  segment: StackSegment,
  chart: Pick<PeriodChartProps, 'formatShare' | 'formatValue' | 'words'>,
): string {
  const { formatShare, formatValue: format, words } = chart
  const share = shareWords(segment.value, stacked.total, formatShare)
  const head = `${periodName(stacked)}: ${seriesPart(segment, format, share)}, ${sumWords(stacked, words, format)}`
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

/** A place the keyboard can stand on: a period, or one of its segments that acts. */
export interface ChartCursor {
  column: number
  segment: number | null
}

/**
 * The places the keyboard can stand on in one period, from the bottom up: the period itself
 * (null), then each of its segments that acts (`acts`), in the stack's order.
 */
function placesIn(one: StackedColumn, acts: (segment: StackSegment) => boolean) {
  return [null, ...one.segments.flatMap((segment, at) => (acts(segment) ? [at] : []))]
}

/**
 * Where an arrow key takes the keyboard. Left and right move between periods, Home and End to the
 * first and the last; up and down between the period and the segments of it that act, up being
 * higher in the stack. Every period is a place to stand, since its hint says what it holds;
 * moving sideways from a segment keeps to the same series where the next period has it acting,
 * else to the nearest segment of it that acts, else the period. Null for a key that moves nothing.
 */
export function nextCursor(
  columns: readonly StackedColumn[],
  cursor: ChartCursor,
  key: string,
  acts: (segment: StackSegment) => boolean = () => false,
): ChartCursor | null {
  const here = columns[cursor.column]
  if (!here) return null
  const land = (to: number): ChartCursor => {
    const column = Math.min(columns.length - 1, Math.max(0, to))
    const level = cursor.segment
    if (level === null) return { column, segment: null }
    const target = columns[column]
    const places = placesIn(target, acts).filter((at) => at !== null)
    const series = here.segments[level]?.series.key
    const same = target.segments.findIndex((segment) => segment.series.key === series)
    if (places.includes(same)) return { column, segment: same }
    const below = places.filter((at) => at <= level)
    const nearest = below.at(-1) ?? places[0]
    return { column, segment: nearest ?? null }
  }
  if (key === 'ArrowRight') return land(cursor.column + 1)
  if (key === 'ArrowLeft') return land(cursor.column - 1)
  if (key === 'Home') return land(0)
  if (key === 'End') return land(columns.length - 1)
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null
  const places = placesIn(here, acts)
  const at = places.indexOf(cursor.segment)
  const next = places[Math.min(places.length - 1, Math.max(0, at + (key === 'ArrowUp' ? 1 : -1)))]
  return { column: cursor.column, segment: next ?? null }
}
