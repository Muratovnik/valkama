/**
 * The width a box cut with `text-overflow: ellipsis` takes so that what it shows of its `words`,
 * the longest start that fits `room` with a «…» `dots` wide, ends at its edge: the browser hides
 * whole letters and leaves the rest of a box sized by anything else empty after the «…», from
 * none to nearly a letter. Null where the whole text fits, or where not even the «…» does.
 *
 * The starts are measured as laid out, by a range over the words themselves: a canvas drew some
 * letters narrower than layout lays them, a hyphen by some 2px, so a box sized by the canvas cut
 * a letter more wherever a hyphen stood before the cut. A quarter pixel more than the start and
 * its «…» keeps the browser from counting the last letter as not fitting by a rounding, and is
 * far narrower than any letter, so it never shows one more.
 */
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const SLACK = 1 / 4

export function ellipsisFit(words: Text, room: number, dots: number): number | null {
  const range = document.createRange()
  const shown = (end: number) => {
    range.setStart(words, 0)
    range.setEnd(words, end)
    return range.getBoundingClientRect().width
  }
  if (shown(words.length) <= room || dots > room) return null
  const ends = [
    0,
    ...Array.from(graphemes.segment(words.data), ({ index, segment }) => index + segment.length),
  ]
  let kept = 0
  let over = ends.length - 1
  while (over - kept > 1) {
    const middle = Math.floor((kept + over) / 2)
    if (shown(ends[middle] ?? 0) + dots <= room) kept = middle
    else over = middle
  }
  return Math.min(room, shown(ends[kept] ?? 0) + dots + SLACK)
}
