/**
 * How many columns a row of segments that may wrap (`SegmentedControl`'s `wrap`) stands in.
 *
 * Where its one line fits the room, the row stays that line, each segment as wide as its words.
 * Where it does not, the segments stand in columns of one width, and only as many as fill every
 * line: a line short of the others ends short of the track, and a segment alone on a line spans
 * it while the line above breaks between two. Where no such count of columns fits, one column.
 * Each line grown to the track instead kept its segments' own widths, so the breaks of two lines
 * missed each other: a set of four stood 126 | 122 over 108 | 140 on a phone, 17px apart.
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

/** The count of columns: `count` where the one line fits, else the most that fill each line. */
export function segmentColumns({ count, gap, line, room, widest }: SegmentRow): number {
  if (line <= room) return count
  for (let columns = count - 1; columns > 1; columns -= 1)
    if (count % columns === 0 && columns * widest + (columns - 1) * gap <= room) return columns
  return 1
}
