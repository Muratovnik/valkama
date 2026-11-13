/**
 * The shapes of a window of a limit and of its readings, as `WindowBar`, `StepLine` and their
 * tables draw them: what a row of the tables holds, and where a step line's steps stand.
 *
 * A reading holds until the next one, since a source writes a reading only when a value changed:
 * the line between two readings is flat and rises or falls at the second, never a slope that
 * would draw values nobody read. The last reading holds up to the moment the line ends.
 */

/** One window as a row of `WindowBarTable`: its name and its figures, each in words. */
export interface WindowRow {
  /** Where steady use would stand now, «40%», or a dash where the window has no pace. */
  evenText: string
  key: string
  label: string
  /** Its state in words, «fresh». */
  noteText: string
  /** The share spent, «62%». */
  valueText: string
}

/** The headings and the empty words of `WindowBarTable`. */
export interface WindowWords {
  empty: string
  even: string
  name: string
  note: string
  value: string
}

/** One reading of a step line: its moment in ms since the epoch and its value. */
export interface StepPoint {
  at: number
  key: string
  /** What the reading is besides its value, its source: «the poll». */
  noteText: string
  /** The reading in words, for the readout and the table: «12:05, 35%, the poll». */
  text: string
  /** Its moment in words, the table's first column: «12:05». */
  timeText: string
  value: number
  /** Its value in words, «35%». */
  valueText: string
}

/** The words around a step line: its two ends, its top, its table's headings and empty state. */
export interface StepWords {
  empty: string
  /** The moment it ends, «16:00». */
  end: string
  note: string
  /** The moment the line starts, «11:00». */
  start: string
  time: string
  /** The value the top of the plot stands for, «100%». */
  top: string
  value: string
}

/** The plot's box in its own units, which the drawing stretches to its host's width. */
export const STEP_WIDTH = 300
export const STEP_HEIGHT = 100

/** Where a step line runs: from `from` to `to` in ms, its values from 0 to `top`. */
export interface StepFrame {
  from: number
  to: number
  top: number
}

/** A moment's place across the plot, from 0 at `from` to `STEP_WIDTH` at `to`, held inside. */
export function stepX(frame: StepFrame, at: number) {
  const span = Math.max(1, frame.to - frame.from)
  return (Math.min(Math.max(at, frame.from), frame.to) - frame.from) * (STEP_WIDTH / span)
}

/** A value's height in the plot, 0 at its foot and `top` at its top, held inside. */
export function stepY(frame: StepFrame, value: number) {
  const top = Math.max(1, frame.top)
  return STEP_HEIGHT - (Math.min(Math.max(value, 0), top) / top) * STEP_HEIGHT
}

/** The top of a plot of percents: 100, or the highest reading where one ran past it. */
export const stepTop = (points: readonly StepPoint[]) =>
  Math.max(100, ...points.map((point) => point.value))

/** A coordinate of the path, to a hundredth of a unit. */
const fixed = (value: number) => value.toFixed(2)

/**
 * The path of the steps: from the first reading, flat to each next one and up or down there,
 * then flat to `end`, the moment the last reading holds to. Readings outside the frame are held
 * at its edges. No readings draw no path.
 */
export function stepPath(frame: StepFrame, points: readonly StepPoint[], end: number): string {
  const [first, ...rest] = points
  if (!first) return ''
  const parts = [`M${fixed(stepX(frame, first.at))},${fixed(stepY(frame, first.value))}`]
  for (const point of rest)
    parts.push(`H${fixed(stepX(frame, point.at))}`, `V${fixed(stepY(frame, point.value))}`)
  parts.push(`H${fixed(stepX(frame, Math.max(end, points.at(-1)?.at ?? end)))}`)
  return parts.join(' ')
}

/**
 * The reading that holds at a place across the plot, from 0 to 1: the last one at or before it,
 * or the first where the place comes before every reading.
 */
export function readingAt(frame: StepFrame, points: readonly StepPoint[], ratio: number) {
  const at = frame.from + Math.min(1, Math.max(0, ratio)) * (frame.to - frame.from)
  const after = points.findIndex((point) => point.at > at)
  return after === -1 ? points.length - 1 : Math.max(0, after - 1)
}
