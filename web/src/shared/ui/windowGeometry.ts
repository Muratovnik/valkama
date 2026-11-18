/**
 * The shapes of a window of a limit and of its readings, as `WindowBar`, `StepLine` and their
 * tables draw them: what a row of the tables holds, where a step line's steps stand, and the
 * corridor of its forecast past them.
 *
 * A reading holds until the next one, since a source writes a reading only when a value changed:
 * the line between two readings is flat and rises or falls at the second, never a slope that
 * would draw values nobody read. The last reading holds up to the moment the line ends.
 *
 * Past that moment a forecast runs to the window's reset as two edges, its slower and its faster
 * pace, each straight between the moments it turns: a pace is a share a minute, so the share it
 * spends grows in a straight line, and an edge that reaches the top of the window runs on flat.
 */

/** One window as a row of `WindowBarTable`: its name and its figures, each in words. */
export interface WindowRow {
  /** Where steady use would stand now, «40%», or a dash where the window has no pace. */
  evenText: string
  /** Its forecast in words, «By the reset: 57% to 61%», or that it has none. */
  forecastText: string
  key: string
  label: string
  /** Its state in words, «fresh», «silent 3 h». */
  noteText: string
  /** The share spent, «62%». */
  valueText: string
}

/** The headings and the empty words of `WindowBarTable`. */
export interface WindowWords {
  empty: string
  even: string
  forecast: string
  name: string
  note: string
  value: string
}

/**
 * The share a window's forecast says it stands at by its reset, in percent: its slower pace's
 * (`low`) and its faster's (`high`), alike for a forecast of one value. `WindowBar` draws it as a
 * hatched tail past the share spent.
 */
export interface WindowAhead {
  high: number
  low: number
}

/** One reading of a step line: its moment in ms since the epoch and its value. */
export interface StepPoint {
  at: number
  key: string
  /** What the reading is besides its value, its source: «the poll». */
  noteText: string
  /** The reading in words, for its hint, its name and the table: «12:05, 35%, the poll». */
  text: string
  /** Its moment in words, the table's first column: «12:05». */
  timeText: string
  value: number
  /** Its value in words, «35%». */
  valueText: string
}

/**
 * What a step line points at past its readings — where the window stands now, and its forecast
 * at the reset — said as its hint, its name and a row of the table say it: what it is, its figure
 * and the lines under them.
 */
export interface StepTarget {
  /** Its figure, «62%», «57–61%». */
  figure: string
  /** What it is, «Now», «Forecast by the reset». */
  name: string
  /** What the figure leaves out, a line each: how old the latest reading is, when the reset is. */
  notes: readonly string[]
}

/** A moment an edge of a forecast turns at, and its share there. */
export interface StepTurn {
  at: number
  value: number
}

/** An edge of a forecast from the moment the line ends to the reset, straight between its turns. */
export type StepCourse = readonly StepTurn[]

/**
 * What a step line draws past its last reading: where the window stands now, at the moment the
 * line ends, and the corridor of its forecast from there to the reset, between its faster edge
 * and its slower, one course for both where the forecast is one value. A window with no forecast
 * to draw has the first alone.
 */
export interface StepAhead {
  forecast: (StepTarget & { high: StepCourse; low: StepCourse }) | null
  now: StepTarget
  /**
   * Whether the window is silent: nothing was measured past its last reading, so the readings'
   * line ends there rather than holding to now. A fresh window's source writes a reading only
   * when a value changes, so its line holds to now.
   */
  silent: boolean
  /** The share the window stands at now, the line's end. */
  value: number
}

/**
 * The words around a step line: its top, the switch of the span it shows, its table's headings
 * and empty state.
 */
export interface StepWords {
  /** The span from the window's start to now and the forecast past it: «To now and the forecast». */
  ahead: string
  empty: string
  note: string
  /** That the reset a corridor runs to stands past the plot's end. */
  past: string
  time: string
  /** The value the top of the plot stands for, «100%». */
  top: string
  value: string
  /** The switch between the two spans, as its name: «Span of the readings». */
  views: string
  /** The span of the whole window, up to its reset: «Whole window». */
  whole: string
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

/** A span of a step line, in ms since the epoch. */
export interface StepSpan {
  from: number
  to: number
}

/**
 * How much of the span a running window opens on lies past now, as a share of the time from its
 * start to now: a third, so now stands at three quarters of the plot and the readings before it
 * take that much of its width, the rest the forecast's.
 */
const AHEAD = 1 / 3

/**
 * The span a running window's step line opens on: from its start to now and as far past now as
 * a third of the time since its start, never past its reset. Drawn to the reset, a week begun
 * two days ago left its readings the first third of the plot.
 */
export const aheadSpan = (from: number, to: number, now: number): StepSpan => ({
  from,
  to: Math.min(to, Math.max(now, from) + (Math.max(now, from) - from) * AHEAD),
})

/**
 * The readings a span shows: those inside it, and the one before it that holds at its start,
 * which the line carries in from the span's edge and which has no mark of its own there.
 */
export function readingsIn(span: StepSpan, points: readonly StepPoint[]) {
  const inside = points.filter((point) => point.at >= span.from && point.at <= span.to)
  let before: StepPoint | undefined
  for (const point of points) if (point.at < span.from) before = point
  return { inside, held: before ? [before, ...inside] : inside }
}

/** Where steady use from a window's start to its reset stands at a moment, in percent. */
export const evenAt = (window: StepSpan, at: number) =>
  ((at - window.from) / Math.max(1, window.to - window.from)) * 100

/** A moment's place across the plot, from 0 at `from` to `STEP_WIDTH` at `to`, held inside. */
export function stepX(frame: StepFrame, at: number) {
  const span = Math.max(1, frame.to - frame.from)
  return (Math.min(Math.max(at, frame.from), frame.to) - frame.from) * (STEP_WIDTH / span)
}

/** A moment's place across the plot as a share of its box, as a style takes it: «75%». */
export const stepAcross = (frame: StepFrame, at: number) =>
  `${(stepX(frame, at) / STEP_WIDTH) * 100}%`

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
 * A place of a step line as the pointer finds it: the moment its mark stands at, and the moments
 * of the stretch it takes the pointer along where no mark is near.
 */
export interface StepAim {
  at: number
  from: number
  to: number
}

/**
 * The place the pointer `x` pixels into a field `width` wide points at, of `aims` drawn over
 * `frame`: the place whose mark stands nearest `x` within `radius` of it, the earlier of two as
 * near; else the first whose stretch holds `x`, held inside the field; null where none does.
 * A mark wins over a stretch, so a reading a few pixels from the next is found at its own mark
 * and never under its neighbour's step.
 */
export function aimAt(
  frame: StepFrame,
  aims: readonly StepAim[],
  x: number,
  { width, radius }: { radius: number; width: number },
): number | null {
  const across = (at: number) => (stepX(frame, at) / STEP_WIDTH) * width
  let nearest: number | null = null
  let distance = radius
  for (const [index, aim] of aims.entries()) {
    const off = Math.abs(across(aim.at) - x)
    if (off < distance || (nearest === null && off === distance)) {
      nearest = index
      distance = off
    }
  }
  if (nearest !== null) return nearest
  const inside = Math.min(Math.max(x, 0), width)
  const found = aims.findIndex((aim) => inside >= across(aim.from) && inside <= across(aim.to))
  return found === -1 ? null : found
}

/** An edge's share at a moment: straight between its turns, held at its ends. */
function courseAt(course: StepCourse, at: number): number {
  let before: StepTurn | undefined
  for (const turn of course) {
    if (turn.at >= at)
      return !before || turn.at === before.at
        ? turn.value
        : before.value + ((turn.value - before.value) * (at - before.at)) / (turn.at - before.at)
    before = turn
  }
  return before?.value ?? 0
}

/** The turns of an edge from `from` to `to`, with its shares at those two moments. */
const courseIn = (course: StepCourse, from: number, to: number): StepTurn[] => [
  { at: from, value: courseAt(course, from) },
  ...course.filter((turn) => turn.at > from && turn.at < to),
  { at: to, value: courseAt(course, to) },
]

/** A point of the plot, in its own units. */
export interface StepPlace {
  x: number
  y: number
}

/**
 * The part of a forecast's corridor a frame shows: each edge as points of the plot, from where
 * the corridor starts, or the frame's start, to the reset, or the frame's end where the reset
 * stands past it (`cut`). Null where the frame holds none of it.
 */
export function corridorIn(frame: StepFrame, high: StepCourse, low: StepCourse) {
  const begins = Math.max(frame.from, high[0]?.at ?? Number.POSITIVE_INFINITY)
  const reset = high.at(-1)?.at ?? Number.NEGATIVE_INFINITY
  const ends = Math.min(frame.to, reset)
  if (ends <= begins) return null
  const place = (turn: StepTurn): StepPlace => ({
    x: stepX(frame, turn.at),
    y: stepY(frame, turn.value),
  })
  return {
    high: courseIn(high, begins, ends).map((turn) => place(turn)),
    low: courseIn(low, begins, ends).map((turn) => place(turn)),
    cut: reset > frame.to,
  }
}
