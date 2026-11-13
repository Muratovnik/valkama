/**
 * The hint of every mark of a chart — a period, a segment of one, a legend entry, a ranked row, a
 * small chart's name, its periods, a reading of a window — shown at the mark through the one hint
 * host (`vTooltip`, `TooltipHost`) when the pointer rests on it or the keyboard brings focus to it.
 * The hint lies in the hint layer, so pointing and leaving move nothing on the page.
 *
 * A hint says what its mark does not print, as every hint does: a period its sum against the
 * period before, what is said of it and its series largest first, each on a line of its own; a
 * segment its series, its value and its share of the period; a legend entry its series' figure
 * over the span and its share; a ranked row or a small chart's name, which print their name and
 * figure, their share of the whole and what the name leaves out. A share is said only where the
 * caller says how it reads (`formatShare`): the words are the caller's, never this module's.
 */
import type {
  PeriodChartProps,
  PeriodWords,
  StackedColumn,
  StackSegment,
} from '@/shared/ui/chartGeometry.ts'
import { columnHead, columnNotes, periodName, seriesParts } from '@/shared/ui/chartGeometry.ts'
import type { TooltipValue } from '@/shared/ui/tooltipAnchors.ts'

type Format = (value: number) => string
/** A share of a whole as the reader reads it, with what it is of: «42 % of the total». */
type ShareFormat = ((ratio: number) => string) | undefined

/** A part's share of its whole in words, or nothing where no share can be said. */
export function shareWords(value: number, whole: number, share: ShareFormat): string {
  return share && whole > 0 && Number.isFinite(value) ? share(Math.max(0, value) / whole) : ''
}

const lines = (...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part)).join('\n')

/** A period in its hint: its sum against the period before, what is said of it, its series. */
export function periodHint(stacked: StackedColumn, words: PeriodWords, format: Format): string {
  const largest = [...stacked.segments].sort((left, right) => right.value - left.value)
  return lines(
    columnHead(stacked, words, format),
    ...columnNotes(stacked, words, { withSum: true }),
    ...seriesParts(largest, format),
  )
}

/** A segment in its hint: its series, its value and its share of the period it stands in. */
export function segmentHint(
  stacked: StackedColumn,
  segment: StackSegment,
  chart: Pick<PeriodChartProps, 'formatShare' | 'formatValue' | 'words'>,
): string {
  const running = stacked.column.incomplete ? ` ${chart.words.incomplete}` : ''
  const part = shareWords(segment.value, stacked.total, chart.formatShare)
  const figure = `${segment.series.label} ${chart.formatValue(segment.value)}${running}`
  return lines(part ? `${figure}, ${part}` : figure, periodName(stacked))
}

/**
 * A series' figure over every period drawn, and its share of all of them: what a legend entry,
 * which prints only the series' name, says in its hint.
 */
export function seriesHint(
  key: string,
  columns: readonly StackedColumn[],
  format: Format,
  share?: ShareFormat,
): string {
  let held = 0
  let whole = 0
  for (const one of columns) {
    whole += one.total
    for (const segment of one.segments) if (segment.series.key === key) held += segment.value
  }
  const part = shareWords(held, whole, share)
  return part ? `${format(held)}, ${part}` : format(held)
}

/**
 * What a mark that prints its name and its figure says besides: its share of the whole and what
 * its name leaves out (`detail`). While the name is cut, the host says it whole first (`words`).
 */
export function namedHint(
  mark: { label: string; value: number; detail?: string },
  whole: number,
  share?: ShareFormat,
): TooltipValue {
  return { text: lines(mark.detail, shareWords(mark.value, whole, share)), words: mark.label }
}
