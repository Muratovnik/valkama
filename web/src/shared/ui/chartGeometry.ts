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
   * Where the row leads, on this origin: the row is then a link, which a press hands out as
   * `follow` and a modified or middle press takes elsewhere as any link is taken.
   */
  href?: string
  kind?: RankedRowKind
  /** The hue of a row that names a series drawn elsewhere on the page; slot 1 otherwise. */
  slot?: SeriesSlot
}

export interface PlacedRow extends RankedRow {
  kind: RankedRowKind
  /** The bar's length as a share of the longest bar, from 0 to 1. */
  length: number
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
 * keeps one order whatever order the rows came in. Every bar is measured against the longest of
 * all of them, the folded tail included, so a tail larger than any one category is not cut.
 */
export function rankRows(rows: readonly RankedRow[]): { ranked: PlacedRow[]; rest: PlacedRow[] } {
  const longest = Math.max(0, ...rows.map((row) => drawable(row.value)))
  const place = (row: RankedRow): PlacedRow => ({
    ...row,
    kind: row.kind ?? 'category',
    length: longest ? drawable(row.value) / longest : 0,
  })
  const ranked = rows
    .filter((row) => (row.kind ?? 'category') === 'category')
    .map((row) => place(row))
    .sort(
      (left, right) =>
        drawable(right.value) - drawable(left.value) ||
        byCodePoint(left.label, right.label) ||
        byCodePoint(left.key, right.key),
    )
  const rest = REST_ORDER.flatMap((kind) =>
    rows.filter((row) => row.kind === kind).map((row) => place(row)),
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
  /** The period named in full, for its accessible name and the table; `label` otherwise. */
  fullLabel?: string
  /** A period still running, whose amount is what it holds so far. */
  incomplete?: boolean
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
  emptyDescription?: string
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
  /** A value as the reader reads it, for the scale, the readout, the names and the table. */
  formatValue: (value: number) => string
}

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
 * is its amount.
 */
export function valueTicks(largest: number, target = 4): number[] {
  if (largest <= 0 || !Number.isFinite(largest)) return [0]
  const rough = largest / target
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((size) => size >= rough)
  const size = step ?? 10 * power
  const count = Math.ceil(largest / size - 1e-9)
  return Array.from({ length: count + 1 }, (_, index) => Number((index * size).toPrecision(12)))
}

/** Each period's stack, and the scale they stand on. */
export function stackColumns(
  columns: readonly PeriodColumn[],
  series: readonly PeriodSeries[],
  marks: readonly PeriodMark[] = [],
): { columns: StackedColumn[]; ticks: number[]; top: number } {
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
  const ticks = valueTicks(Math.max(0, ...stacked.map((one) => one.total)))
  return { columns: stacked, ticks, top: ticks.at(-1) || 1 }
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
  /** Which point of the label stands there; the first and the last keep inside the edge. */
  edge: 'end' | 'middle' | 'start'
  key: number | string
  /** Where along the edge, from 0 at its start (or the baseline) to 1 at its end. */
  offset: number
  text: string
  /** A second line under the first: "so far" under a period still running. */
  note?: string
}

function edgeOf(index: number, count: number): PlacedTick['edge'] {
  if (index === 0) return 'start'
  if (index === count - 1) return 'end'
  return 'middle'
}

/** The time axis: each period it has room to name under its column, and any still running. */
export function dayTicks(
  columns: readonly PeriodColumn[],
  width: number,
  incomplete: string,
): PlacedTick[] {
  const count = columns.length
  const named = new Set(labelledColumns(count, width))
  for (const [index, column] of columns.entries()) if (column.incomplete) named.add(index)
  return [...named]
    .sort((left, right) => left - right)
    .flatMap((index) => {
      const column = columns[index]
      if (!column) return []
      const edge = edgeOf(index, count)
      const offset = { start: 0, end: 1, middle: (index + 0.5) / count }[edge]
      const note = column.incomplete ? { note: incomplete } : {}
      return [{ key: column.key, text: column.label, offset, edge, ...note }]
    })
}

type Format = (value: number) => string

const periodName = (stacked: StackedColumn) => stacked.column.fullLabel ?? stacked.column.label

/** What a period holds, in words: its sum, each series in it, and what is said of it. */
export function columnSummary(stacked: StackedColumn, words: PeriodWords, format: Format): string {
  const parts = stacked.segments.map(
    (segment) => `${segment.series.label} ${format(segment.value)}`,
  )
  const head = hasSum(stacked)
    ? `${periodName(stacked)}: ${words.total} ${format(stacked.total)}`
    : periodName(stacked)
  return [parts.length ? `${head}; ${parts.join(', ')}` : head, ...columnNotes(stacked, words)]
    .filter(Boolean)
    .join('. ')
}

/** One segment in words, with the sum of the period it stands in. */
export function segmentSummary(
  stacked: StackedColumn,
  segment: StackSegment,
  words: PeriodWords,
  format: Format,
): string {
  const head = `${periodName(stacked)}: ${segment.series.label} ${format(segment.value)}, ${words.total} ${format(stacked.total)}`
  return [head, ...columnNotes(stacked, words)].join('. ')
}

/** A change the chart marks, numbered in time order: the plot shows the number, a note the words. */
export interface ChangeNote {
  index: number
  number: number
  period: string
  text: string
}

export function changeNotes(columns: readonly StackedColumn[]): ChangeNote[] {
  return columns
    .flatMap((one, index) =>
      one.marks.map((text) => ({ index, period: one.column.fullLabel ?? one.column.label, text })),
    )
    .map((note, at) => ({ ...note, number: at + 1 }))
}

/** The numbers over the plot, one label per period that changed, at that period's start. */
export function changeMarkers(notes: readonly ChangeNote[], count: number): PlacedTick[] {
  const byColumn = new Map<number, number[]>()
  for (const note of notes)
    byColumn.set(note.index, [...(byColumn.get(note.index) ?? []), note.number])
  return [...byColumn].map(([index, numbers]) => ({
    key: index,
    text: numbers.join(', '),
    offset: index / count,
    edge: 'middle',
  }))
}

/**
 * What is said of a period besides its numbers: that it is still running, which series have no
 * figure in it, what changed.
 */
export function columnNotes(stacked: StackedColumn, words: PeriodWords): string[] {
  const names = stacked.absent.map((one) => one.label).join(', ')
  const absent = names ? [words.absent ? `${words.absent}: ${names}` : names] : []
  return [...(stacked.column.incomplete ? [words.incomplete] : []), ...absent, ...stacked.marks]
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
