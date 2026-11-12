/**
 * The arithmetic behind `SmallMultiples`, kept apart from what draws it so a test can hold every
 * number a reader is shown: which multiples share the scale, the scale's top, and each period's
 * height as a share of that top.
 *
 * Nothing here formats a value or knows a word: the caller hands in each multiple's figure as it
 * reads, and the words as props.
 */
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import { roundAxis } from '@/shared/ui/chartGeometry.ts'
import type { ValueAxis } from '@/shared/ui/chartGeometry.ts'

/**
 * What a multiple is. A category and the folded tail (`other`) share one scale; work with
 * nothing to file it under (`none`) and work the record cannot place (`unknown`) are no value of
 * the dimension, so they stand apart, read by their figures, and never set the scale.
 */
type MultipleKind = 'category' | 'none' | 'other' | 'unknown'

export interface SmallMultiple {
  key: string
  label: string
  /** Each period's amount, in the order of the periods; null for a period with no figure. */
  values: readonly (number | null)[]
  /** The multiple's figure over the whole span, as the reader reads it: units and all. */
  valueText: string
  kind?: MultipleKind
  /** The hue of the value wherever the page draws it; the neutral when it has none. */
  slot?: SeriesSlot
}

export interface MultiplePeriod {
  key: string
  /** What the table's heading over the period says: short, a day or an hour. */
  label: string
}

export interface MultiplesWords {
  /** The heading over the table's names. */
  category: string
  empty: string
  /** What stands before the shared scale's top, said once: "Every chart from 0 to". */
  scale: string
  /** The heading over each multiple's figure for the whole span, in the table. */
  total: string
  /** What a period with no figure says in the table; a dash when not given. */
  absent?: string
  emptyDescription?: string
}

export interface PlacedMultiple extends SmallMultiple {
  /** Each period's height as a share of the scale's top, 0 to 1; null for no figure. */
  heights: (number | null)[]
  kind: MultipleKind
}

const drawable = (value: number | null) =>
  value !== null && Number.isFinite(value) && value > 0 ? value : 0

const kindOf = (multiple: SmallMultiple): MultipleKind => multiple.kind ?? 'category'

const APART: readonly MultipleKind[] = ['none', 'unknown']

/**
 * The multiples on the shared scale — the categories in the order given, then the folded tail —
 * and the ones apart, in a fixed order. The scale's top is the first round step at or past the
 * largest period of any multiple on it, so every chart reads against the same height.
 */
export function placeMultiples(
  multiples: readonly SmallMultiple[],
  axis: ValueAxis = roundAxis(String),
): {
  apart: PlacedMultiple[]
  shared: PlacedMultiple[]
  top: number
  /** The top as the axis says it. */
  topText: string
} {
  const onScale = [
    ...multiples.filter((one) => kindOf(one) === 'category'),
    ...multiples.filter((one) => kindOf(one) === 'other'),
  ]
  const largest = Math.max(
    0,
    ...onScale.flatMap((one) => one.values.map((value) => drawable(value))),
  )
  const topStep = axis(largest).at(-1)
  const top = largest > 0 ? (topStep?.value ?? largest) : 0
  /** A period's height as a share of the top: none for no figure, nothing on a scale of zero. */
  const heightOf = (value: number | null) => {
    if (value === null) return null
    return top > 0 ? Math.min(1, drawable(value) / top) : 0
  }
  const place = (one: SmallMultiple): PlacedMultiple => ({
    ...one,
    kind: kindOf(one),
    heights: one.values.map((value) => heightOf(value)),
  })
  const apart = APART.flatMap((kind) =>
    multiples.filter((one) => kindOf(one) === kind).map((one) => ({ ...place(one), heights: [] })),
  )
  const topText = topStep?.text ?? ''
  return { shared: onScale.map((one) => place(one)), apart, top, topText }
}
