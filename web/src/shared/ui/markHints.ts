/**
 * The hint of every mark of a chart — a period, a segment of one, a legend entry, a ranked row, a
 * small chart's name, its periods, a sector of a ring, a reading of a window and what its line
 * points at past its readings, the window now and its forecast at the reset — shown at the mark
 * through the one hint host (`vTooltip`, `TooltipHost`) when the pointer rests on it or the
 * keyboard brings focus to it. The hint lies in the hint layer, so pointing and leaving move
 * nothing on the page.
 *
 * A hint says what its mark does not print, as every hint does: a period its sum against the
 * period before, what is said of it and its series largest first with each one's share of the
 * period, each on a line of its own; a legend entry its series' figure over the span and its
 * share; a ranked row or a small chart's name, which print their name and figure, their share of
 * the whole and what the name leaves out; a sector its figure and share, and for the rest the
 * parts it holds. A segment has no hint of its own: it stands in its period, whose hint says
 * everything a segment's did, so pointing across a period never swaps one hint for another. A
 * share is said only where the caller says how it reads (`formatShare`): the words are the
 * caller's, never this module's.
 *
 * Every hint here is drawn as a grid (`TooltipBody`). A mark of one series names it in the grid's
 * head beside its series' swatch, as the legend draws it, so the hint says which hue it speaks
 * for: the swatch of a ring's sector, a ranked row's bar, a small chart, a legend entry, a step
 * line's reading and its targets past them. A period's head is the period, with a row for each
 * series and its swatch.
 * The hint's text stays what assistive technology reads and the page marks.
 */
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type { PeriodChartProps, StackedColumn } from '@/shared/ui/chartGeometry.ts'
import {
  columnHead,
  columnNotes,
  periodName,
  saysSum,
  seriesParts,
  shareWords,
} from '@/shared/ui/chartGeometry.ts'
import type { RingSector } from '@/shared/ui/donutGeometry.ts'
import type { TextRun } from '@/shared/ui/textRuns.ts'
import type { TooltipBody, TooltipValue } from '@/shared/ui/tooltipAnchors.ts'
import type { StepPoint, StepTarget } from '@/shared/ui/windowGeometry.ts'

type Format = (value: number) => string
/** A share of a whole as the reader reads it, with what it is of: «42 % of the total». */
type ShareFormat = ((ratio: number) => string) | undefined

const lines = (...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part)).join('\n')

/** A name's runs where it has them, and nothing where it has none. */
const runsOf = (runs: readonly TextRun[] | undefined) => (runs ? { runs } : {})

/** What is said under a grid's rows: each line given, none empty. */
const notesOf = (...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part))

/**
 * A series as its hint names it: its name and its hue, where it draws one. A name its mark draws in
 * runs (`labelRuns`), a task's title with code in it, is drawn in them in the hint too.
 */
interface Named {
  label: string
  labelRuns?: readonly TextRun[]
  slot?: SeriesSlot
}

/** The grid of a mark of one series: its swatch and name with a figure, and what is said under. */
const seriesBody = (
  { label, labelRuns, slot }: Named,
  figure: string | undefined,
  notes: readonly string[],
): TooltipBody => ({
  head: {
    name: label,
    ...runsOf(labelRuns),
    ...(figure ? { figure } : {}),
    ...(slot === undefined ? {} : { slot }),
  },
  rows: [],
  notes,
})

type PeriodHintChart = Pick<
  PeriodChartProps,
  'formatPart' | 'formatShare' | 'formatValue' | 'words'
>

/**
 * A period in its hint: its sum against the period before, what is said of it, and its series
 * largest first, each with its share of the period where the chart says how a share reads; and
 * the same drawn as a grid, its notes under its series there.
 */
export function periodHint(stacked: StackedColumn, chart: PeriodHintChart) {
  const { formatShare, formatValue: format, words } = chart
  const largest = [...stacked.segments].sort((left, right) => right.value - left.value)
  const notes = columnNotes(stacked, words, { withSum: true })
  const text = lines(
    columnHead(stacked, words, format),
    ...notes,
    ...seriesParts(largest, format, (segment) =>
      shareWords(segment.value, stacked.total, formatShare),
    ),
  )
  return { text, body: periodBody(stacked, largest, notes, chart) } satisfies TooltipValue
}

/** A period's hint as a grid: its head, the period compared with, its series, its notes. */
function periodBody(
  stacked: StackedColumn,
  largest: StackedColumn['segments'],
  notes: string[],
  { formatPart, formatValue: format, words }: PeriodHintChart,
): TooltipBody {
  const { before, incomplete } = stacked.column
  const running = incomplete ? ` ${words.incomplete}` : ''
  const sum = `${format(stacked.total)}${running}`
  return {
    head: { name: periodName(stacked), ...(saysSum(stacked) ? { figure: sum } : {}) },
    quiet:
      words.before && typeof before === 'number'
        ? [{ name: words.before, figure: format(before) }]
        : [],
    rows: largest.map((segment) => ({
      key: segment.series.key,
      slot: segment.series.slot,
      name: segment.series.label,
      ...runsOf(segment.series.labelRuns),
      figure: format(segment.value),
      share: shareWords(segment.value, stacked.total, formatPart) || undefined,
    })),
    notes,
  }
}

/**
 * What a legend entry, which prints only its series' name, says in its hint: the series' figure
 * and its share of the whole, under its name beside its swatch.
 */
function figureHint(series: Named, figure: string, share: string): TooltipValue {
  return {
    text: share ? `${figure}, ${share}` : figure,
    body: seriesBody(series, figure, notesOf(share)),
  }
}

/** A series' figure over every period drawn, and its share of all of them, as its entry's hint. */
export function seriesHint(
  series: Named & { key: string },
  columns: readonly StackedColumn[],
  format: Format,
  share?: ShareFormat,
): TooltipValue {
  let held = 0
  let whole = 0
  for (const one of columns) {
    whole += one.total
    for (const segment of one.segments) if (segment.series.key === series.key) held += segment.value
  }
  return figureHint(series, format(held), shareWords(held, whole, share))
}

/**
 * What a mark that prints its name and its figure says besides: its share of the whole where the
 * host gives one (`whole` and `share`) and what its name leaves out (`detail`), under its whole
 * name beside its hue. While the name is cut and there is nothing besides, the host says it whole
 * (`words`).
 */
export function namedHint(
  mark: Named & { value: number; detail?: string },
  whole = 0,
  share?: ShareFormat,
): TooltipValue {
  const notes = notesOf(mark.detail, shareWords(mark.value, whole, share))
  return { text: lines(...notes), words: mark.label, body: seriesBody(mark, undefined, notes) }
}

/** A period of a small chart: the chart's name beside its hue with the period's figure, then the period. */
export function multiplePeriodHint(chart: Named, period: string, figure: string): TooltipValue {
  return {
    text: `${chart.label}\n${period}: ${figure}`,
    body: seriesBody(chart, figure, [period]),
  }
}

/** A reading of a step line: its moment and value beside its line's hue, and its source. */
export function readingHint(point: StepPoint, slot: SeriesSlot): TooltipValue {
  return {
    text: point.text,
    body: seriesBody({ label: point.timeText, slot }, point.valueText, notesOf(point.noteText)),
  }
}

/** A place of a step line in its hint: its words, and the grid that draws them. */
interface PlaceHint {
  body: TooltipBody
  text: string
}

/**
 * What a step line points at past its readings — the window now, its forecast at the reset — in
 * its hint: what it is with its figure in the head, beside the line's swatch, and the lines under
 * them, those the line adds (`more`) last.
 */
export function targetHint(
  target: StepTarget,
  slot: SeriesSlot,
  more: readonly string[] = [],
): PlaceHint {
  const notes = notesOf(...target.notes, ...more)
  return {
    text: lines(`${target.name}: ${target.figure}`, ...notes),
    body: seriesBody({ label: target.name, slot }, target.figure, notes),
  }
}

/** A place's hint that also says the words of `others` after its own lines, its text its own. */
function hintWithNearby(hint: PlaceHint, others: readonly PlaceHint[]): PlaceHint {
  if (!others.length) return hint
  const said = others.flatMap((other) => other.text.split('\n'))
  return { ...hint, body: { ...hint.body, notes: [...(hint.body.notes ?? []), ...said] } }
}

/**
 * The hint of each of a step line's places, with the words of every other place whose mark stands
 * within the pointer's reach of its own (`near`), in the order they stand: of two places that near,
 * the pointer finds the nearer alone, and the other's facts would be out of its reach. Its text,
 * the place's name, stays its own, which the keyboard reaches each place by.
 */
export function hintsWithNearby(
  places: readonly { aim: { at: number }; hint: PlaceHint }[],
  near: (one: number, other: number) => boolean,
): PlaceHint[] {
  return places.map((place) =>
    hintWithNearby(
      place.hint,
      places
        .filter((other) => other !== place && near(other.aim.at, place.aim.at))
        .map((other) => other.hint),
    ),
  )
}

/** The parts of a folded rest its hint lists by name; the others are said as one line. */
const REST_LISTED = 5

/** What a ring's hint needs of its chart: how a figure and a share read, and the rest's name. */
export interface RingHintChart {
  formatValue: Format
  /** A share bare, «42 %», against each part of the rest. */
  formatPart?: ShareFormat
  /** A share of the whole as the reader reads it, «42 % of the total». */
  formatShare?: ShareFormat
  /** The name of what the smaller parts fold into, by how many it holds. */
  rest: (count: number) => string
}

/** A sector of a ring as its hint and its legend entry name it: its name, figure and share. */
export function ringPart(sector: RingSector, whole: number, chart: RingHintChart) {
  return {
    label: sector.row ? sector.row.label : chart.rest(sector.members.length),
    ...runsOf(sector.row?.labelRuns),
    slot: sector.slot,
    figure: sector.row?.valueText ?? chart.formatValue(sector.value),
    share: shareWords(sector.value, whole, chart.formatShare),
  }
}

/**
 * A sector's hint: its name beside its hue, its figure, and its share of the whole; for the rest,
 * its parts largest first, the first `REST_LISTED` each with its figure and bare share and the
 * others as one line, since the rest of a breakdown by task holds hundreds. What the name leaves
 * out (`detail`) closes it.
 */
export function ringHint(sector: RingSector, whole: number, chart: RingHintChart): TooltipValue {
  const part = ringPart(sector, whole, chart)
  const detail = sector.row?.detail
  const bare = (value: number) => shareWords(value, whole, chart.formatPart) || undefined
  const listed = sector.members.slice(0, REST_LISTED).map((member) => ({
    key: member.key,
    name: member.label,
    ...runsOf(member.labelRuns),
    figure: member.valueText,
    share: bare(member.value),
  }))
  const others = sector.members.slice(REST_LISTED)
  const othersValue = others.reduce((sum, member) => sum + Math.max(0, member.value), 0)
  const rows = others.length
    ? [
        ...listed,
        {
          name: chart.rest(others.length),
          figure: chart.formatValue(othersValue),
          share: bare(othersValue),
        },
      ]
    : listed
  return {
    text: lines(
      [part.figure, part.share].filter(Boolean).join(', '),
      ...rows.map((row) => `${row.name}: ${row.figure}`),
      detail,
    ),
    body: {
      head: { name: part.label, ...runsOf(part.runs), figure: part.figure, slot: part.slot },
      rows,
      notes: notesOf(part.share, detail),
    },
  }
}
