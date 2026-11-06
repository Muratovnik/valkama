/**
 * Where a lane heading's actions stand, worked out from widths alone. At the end
 * of the heading's last line when that line has room for them. Where it has not:
 * beside the title when the title stays whole there, and otherwise still at the
 * end, taking the last part of the line down with them onto a line of their own —
 * so they cost the heading a line rather than the title its words, and never
 * stand on a line alone. Only where nothing can come down with them — the last
 * part already starts its line, would leave the state alone on the line above, or
 * does not fit a line with them — do they stand alone at the end.
 *
 * The parts are laid on lines as flex lays them: a part starts a line when it and
 * the gap before it do not fit after the parts already there, and a part that
 * fits exactly stays. The widths come in whole units — the 64ths of a pixel
 * layout itself works in — so the sums here are the sums flex makes, with no
 * tolerance either way. A heading once foretold its lines with half a pixel to
 * spare, said they fitted where flex wrapped them, and kept whichever answer the
 * width it came from had given.
 */

export type LanePlace = 'beside' | 'end' | 'tied'

/** What the place follows from, in the same units throughout. */
export interface LaneLines {
  actions: number
  /** The gap between two parts of a line. */
  gap: number
  /** The room one line has. */
  line: number
  /** The widths of the parts before the actions, in the order they are laid out. */
  parts: number[]
  /** Which of the parts is the state, or -1: a line is never left to it alone. */
  state: number
  /** Whether the title, whole, fits beside the actions on the first line. */
  wholeBeside: boolean
}

/** The parts of each line `parts` are laid on, by their place in `parts`. */
function linesOf(parts: number[], line: number, gap: number): number[][] {
  const lines: number[][] = []
  let used = 0
  for (const [at, width] of parts.entries()) {
    const current = lines.at(-1)
    if (current && used + gap + width <= line) {
      current.push(at)
      used += gap + width
    } else {
      lines.push([at])
      used = width
    }
  }
  return lines
}

export function placeOf({ actions, gap, line, parts, state, wholeBeside }: LaneLines): LanePlace {
  const last = linesOf(parts, line, gap).at(-1) ?? []
  const width = (at: number) => parts[at] ?? 0
  const used = last.reduce((sum, at, index) => sum + (index > 0 ? gap : 0) + width(at), 0)
  if (last.length === 0 || used + gap + actions <= line) return 'end'
  if (wholeBeside) return 'beside'
  const kept = last.slice(0, -1)
  const ending = last.at(-1) ?? -1
  const tieable =
    kept.length > 0 &&
    !(kept.length === 1 && kept[0] === state) &&
    width(ending) + gap + actions <= line
  return tieable ? 'tied' : 'end'
}
