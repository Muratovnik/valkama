/**
 * Which of the chart palette's hues a series is drawn in.
 *
 * A colour belongs to a name, not to a rank: an account that is blue in one chart is blue in
 * the next one and after a reload, and a filter that removes a series does not repaint the rest.
 * So the slots follow one stable order of the names themselves — by code point, which no locale
 * or input order moves — and never their values. Hand the whole domain to one call (every
 * account in the period, not the ones a chart happens to show) and give every chart the same
 * answer; two calls over two different sets can disagree.
 *
 * The palette's order is what keeps neighbours apart (`--color-series-*` in `tokens.css`), so the
 * slots are handed out in sequence and none is ever generated or reused. A name past the last
 * slot gets `other`, the neutral a folded tail is drawn in: such series are summed into one
 * "other" series by the caller rather than told apart by a hue they do not have.
 */

/** How many hues the palette holds: `--color-series-1` to `--color-series-6`. */
export const SERIES_SLOT_COUNT = 6

/** A palette slot, or the neutral of everything that is not one category. */
export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6 | 'other'

function byCodePoint(left: string, right: string) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/** The slot each distinct name takes, in the palette's order. */
export function seriesSlots(names: Iterable<string>): Map<string, SeriesSlot> {
  const ordered = [...new Set(names)].sort(byCodePoint)
  return new Map(
    ordered.map((name, index) => [
      name,
      index < SERIES_SLOT_COUNT ? ((index + 1) as SeriesSlot) : 'other',
    ]),
  )
}
