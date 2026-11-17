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
 * "other" series by the caller rather than told apart by a hue they do not have. What is not a
 * name at all — work with no value, work nobody can place — is `apart`, a second neutral of
 * another lightness, so it is never taken for the folded tail it can stand on in a stack.
 */

/** How many hues the palette holds: `--color-series-1` to `--color-series-6`. */
export const SERIES_SLOT_COUNT = 6

/**
 * A palette slot; `other`, the neutral of a folded tail; or `apart`, the darker neutral of what is
 * not a category at all.
 */
export type SeriesSlot = 1 | 2 | 3 | 4 | 5 | 6 | 'apart' | 'other'

/**
 * The pairs of hues that stay apart beside each other in a stack but not in every pair: each
 * falls short, under protanopia, deuteranopia or ordinary vision, of what every other pair of the
 * palette keeps, and no hue of the dark band could take a fifth place beside the first four
 * without making another such pair. `tests/seriesColors.test.ts` holds this list to the tokens.
 */
export const CLOSE_SLOTS: readonly (readonly [number, number])[] = [
  [1, 6],
  [2, 5],
  [4, 6],
]

/**
 * Whether two slots stay apart for every reader whichever stands beside the other, as the parts
 * of a ring can: two hues no close pair joins, or a hue beside a neutral, or the two neutrals.
 * A slot is never apart from itself.
 */
export function apartInAnyPair(one: SeriesSlot, other: SeriesSlot): boolean {
  if (one === other) return false
  if (typeof one !== 'number' || typeof other !== 'number') return true
  return !CLOSE_SLOTS.some(
    ([first, second]) => (first === one && second === other) || (first === other && second === one),
  )
}

function byCodePoint(left: string, right: string) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

/**
 * The slot each name takes by its rank: the first `count` of `ranked`, in order, take the palette's
 * hues in sequence, the rest the neutral. For a page whose charts all read one ranking — a value
 * is the colour of its place, so every chart of the page that is handed the same ranking agrees,
 * and a new ranking (another measure) may repaint.
 */
export function rankSlots(
  ranked: Iterable<string>,
  count = SERIES_SLOT_COUNT,
): Map<string, SeriesSlot> {
  const named = Math.min(count, SERIES_SLOT_COUNT)
  return new Map(
    [...new Set(ranked)].map((name, index) => [
      name,
      index < named ? ((index + 1) as SeriesSlot) : 'other',
    ]),
  )
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
