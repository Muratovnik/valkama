/**
 * The hint of every mark of a chart — a period, a segment of one, a legend entry, a ranked row, a
 * small chart's name, its periods, a reading of a window — shown at the mark through the one hint
 * host (`vTooltip`, `TooltipHost`) when the pointer rests on it or the keyboard brings focus to it.
 * The hint lies in the hint layer, so pointing and leaving move nothing on the page.
 *
 * A hint says what its mark does not print, as every hint does: a period its sum against the
 * period before, what is said of it and its series largest first with each one's share of the
 * period, each on a line of its own; a legend entry its series' figure over the span and its
 * share; a ranked row or a small chart's name, which print their name and figure, their share of
 * the whole and what the name leaves out. A segment has no hint of its own: it stands in its
 * period, whose hint says everything a segment's did, so pointing across a period never swaps
 * one hint for another. A share is said only where the caller says how it reads (`formatShare`):
 * the words are the caller's, never this module's.
 */
import type { PeriodWords, StackedColumn } from '@/shared/ui/chartGeometry.ts'
import { columnHead, columnNotes, seriesParts, shareWords } from '@/shared/ui/chartGeometry.ts'
import type { TooltipValue } from '@/shared/ui/tooltipAnchors.ts'

type Format = (value: number) => string
/** A share of a whole as the reader reads it, with what it is of: «42 % of the total». */
type ShareFormat = ((ratio: number) => string) | undefined

const lines = (...parts: readonly (string | null | undefined)[]) =>
  parts.filter((part): part is string => Boolean(part)).join('\n')

/**
 * A period in its hint: its sum against the period before, what is said of it, and its series
 * largest first, each with its share of the period where the chart says how a share reads.
 */
export function periodHint(
  stacked: StackedColumn,
  words: PeriodWords,
  format: Format,
  share?: ShareFormat,
): string {
  const largest = [...stacked.segments].sort((left, right) => right.value - left.value)
  return lines(
    columnHead(stacked, words, format),
    ...columnNotes(stacked, words, { withSum: true }),
    ...seriesParts(largest, format, (segment) => shareWords(segment.value, stacked.total, share)),
  )
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
