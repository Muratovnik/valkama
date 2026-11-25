/**
 * The width a box cut with `text-overflow: ellipsis` takes so that what it shows of its `words`,
 * the longest start that fits `room` with a «…» `dots` wide, ends at its edge: the browser hides
 * whole letters and leaves the rest of a box sized by anything else empty after the «…», from
 * none to nearly a letter. Null where the whole text fits.
 *
 * A cut start is never narrower than its first letter and the whole «…» (`ellipsisLeast`), even
 * where the room is: as wide as the «…» alone, the box still drew the first letter and clipped
 * the «…» to one dot. Whoever sets the room holds at least that much of it for the start.
 *
 * The starts are measured as laid out, by a range over the words themselves: a canvas drew some
 * letters narrower than layout lays them, a hyphen by some 2px, so a box sized by the canvas cut
 * a letter more wherever a hyphen stood before the cut. A quarter pixel more than the start and
 * its «…» keeps the browser from counting the last letter as not fitting by a rounding, and is
 * far narrower than any letter, so it never shows one more.
 */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const SLACK = 1 / 4

/** The ends of the starts of `words`, by whole letters, the empty start first. */
const endsOf = (words: Text) => [
  0,
  ...Array.from(graphemes.segment(words.data), ({ index, segment }) => index + segment.length),
]

/** How wide the first `end` code units of `words` are laid out. */
function shownOf(words: Text) {
  const range = document.createRange()
  return (end: number) => {
    range.setStart(words, 0)
    range.setEnd(words, end)
    return range.getBoundingClientRect().width
  }
}

/** The least a cut start of `words` shows: its first letter and the whole «…», `dots` wide. */
export function ellipsisLeast(words: Text, dots: number): number {
  return shownOf(words)(endsOf(words)[1] ?? 0) + dots + SLACK
}

export function ellipsisFit(words: Text, room: number, dots: number): number | null {
  const shown = shownOf(words)
  if (shown(words.length) <= room) return null
  const ends = endsOf(words)
  let kept = 0
  let over = ends.length - 1
  while (over - kept > 1) {
    const middle = Math.floor((kept + over) / 2)
    if (shown(ends[middle] ?? 0) + dots <= room) kept = middle
    else over = middle
  }
  return kept === 0
    ? ellipsisLeast(words, dots)
    : Math.min(room, shown(ends[kept] ?? 0) + dots + SLACK)
}
