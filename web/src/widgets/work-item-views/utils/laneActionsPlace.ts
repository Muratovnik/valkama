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
 * The state may also stand on the title's line, apart from the parts after it,
 * where it fits beside the whole title: it does wherever that draws the heading
 * in fewer lines, which is where the state and the counts below a short title
 * would otherwise leave the actions a line of their own.
 *
 * The parts are laid on lines as flex lays them: a part starts a line when it and
 * the gap before it do not fit after the parts already there, and a part that
 * fits exactly stays. The widths come in whole units — the sixty-fourths of a pixel
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

/** What a heading's place and the state's line follow from: its lines, and its first line. */
export interface LaneHead extends Omit<LaneLines, 'wholeBeside'> {
  /** The room the first line has after the whole title, to the heading's end. */
  first: number
  /** The gap the actions keep from the title they stand beside. */
  titleGap: number
  /** Whether the parts after the title may go onto lines of their own. */
  wraps: boolean
}

export interface LaneLayout {
  place: LanePlace
  /** Whether the state stands on the title's line, apart from the parts after it. */
  raised: boolean
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

/** The place, and how many lines the parts and the actions take below the title. */
function settle({ actions, gap, line, parts, state, wholeBeside }: LaneLines) {
  const lines = linesOf(parts, line, gap)
  const last = lines.at(-1) ?? []
  const width = (at: number) => parts[at] ?? 0
  const used = last.reduce((sum, at, index) => sum + (index > 0 ? gap : 0) + width(at), 0)
  if (last.length === 0 || used + gap + actions <= line)
    return { place: 'end' as LanePlace, lines: lines.length }
  if (wholeBeside) return { place: 'beside' as LanePlace, lines: lines.length }
  const kept = last.slice(0, -1)
  const ending = last.at(-1) ?? -1
  const tieable =
    kept.length > 0 &&
    !(kept.length === 1 && kept[0] === state) &&
    width(ending) + gap + actions <= line
  return { place: (tieable ? 'tied' : 'end') as LanePlace, lines: lines.length + 1 }
}

export function placeOf(lines: LaneLines): LanePlace {
  return settle(lines).place
}

/**
 * The place, and whether the state stands on the title's line. It does only where it fits
 * beside the whole title and the heading then takes fewer lines; beside the title the actions
 * then need room after the state too.
 */
export function layoutOf({ first, titleGap, wraps, ...lines }: LaneHead): LaneLayout {
  const below = settle({ ...lines, wholeBeside: titleGap + lines.actions <= first })
  const state = lines.parts[lines.state]
  if (!wraps || state === undefined || lines.gap + state > first)
    return { place: below.place, raised: false }
  const after = first - lines.gap - state
  const raised = settle({
    ...lines,
    parts: lines.parts.filter((_, at) => at !== lines.state),
    state: -1,
    wholeBeside: titleGap + lines.actions <= after,
  })
  return raised.lines < below.lines
    ? { place: raised.place, raised: true }
    : { place: below.place, raised: false }
}
