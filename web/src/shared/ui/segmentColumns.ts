/**
 * How many columns a row of segments that may wrap (`SegmentedControl`'s `wrap`) stands in.
 *
 * Where its one line fits the room, the row stays that line, each segment as wide as its words.
 * Where it does not, the segments stand in columns of one width on the fewest lines the room
 * allows, and in the fewest columns that keep to that many lines, so the last line is as near
 * full as it can be and the lines over it are full: four stand two over two, never three over
 * one, and five in room for three or four stand three over two. A count that no number of columns
 * divides ends on a shorter last line, its segments under the columns of the lines above. Where
 * not even two columns fit, one column.
 *
 * Each line grown to the track instead kept its segments' own widths, so the breaks of two lines
 * missed each other: a set of four stood 126 | 122 over 108 | 140 on a phone, 17px apart. Held to
 * a count of columns that fills every line, the five periods of Analytics would have had none but
 * one, five lines tall in a bar that stays on the screen.
 */
export interface SegmentRow {
  /** How many segments the row holds. */
  count: number
  /** The gap between two segments, in px. */
  gap: number
  /** The width of the row's one line, its segments at their own widths and the gaps between. */
  line: number
  /** The room the track gives its segments, in px. */
  room: number
  /** The widest segment, its words in the chosen weight, in px. */
  widest: number
}

/** The count of columns: `count` where the one line fits, else as the docstring above says. */
export function segmentColumns({ count, gap, line, room, widest }: SegmentRow): number {
  if (line <= room) return count
  // The one line did not fit, so the row stands on two lines at least.
  let fit = count - 1
  while (fit > 1 && fit * widest + (fit - 1) * gap > room) fit -= 1
  return fit < 2 ? 1 : Math.ceil(count / Math.ceil(count / fit))
}
