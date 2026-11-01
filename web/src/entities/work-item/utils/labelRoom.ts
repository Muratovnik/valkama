/**
 * How many label chips one line has room for.
 *
 * A tile's labels used to wrap, and every row of chips cost the 28px a chip's
 * pointer target takes, so three labels in a narrow column stood one per row
 * and the tile grew by a row each. One line holds as many whole chips as fit,
 * in order, and keeps room for the «+N» that counts the rest.
 */
export interface ChipLine {
  /** The drawn width of each candidate chip, in order, in px. */
  chips: readonly number[]
  /** The gap between two marks on the line, in px. */
  gap: number
  /** The width of the line, in px. */
  line: number
  /** The width of the «+N» that counts the labels left out, in px. */
  more: number
  /** How many labels the item has, candidates or not. */
  total: number
}

/**
 * The number of chips that fit, at least one: a lone chip too wide for the
 * line is shortened rather than replaced by a count with nothing beside it.
 */
export function chipsThatFit({ chips, gap, more, line, total }: ChipLine): number {
  let used = 0
  let room = 0
  for (const [index, width] of chips.entries()) {
    const next = used + (index ? gap : 0) + width
    const left = total - (index + 1)
    if (next + (left > 0 ? gap + more : 0) > line) break
    used = next
    room = index + 1
  }
  return Math.max(1, room)
}
