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
 * The line drawn of it follows the faster edge and stops where that edge reaches the whole
 * window, the run-out, or at the reset where it never does (`forecastEnd`).
 *
 * Where a window's count restarted inside it, the line falls at a reading with the reset
 * unchanged; the restart stands at that reading's moment, before it in the order the readings
 * stand (`stepStops`), and marks the fall (`restartFall`). A line of several windows falls the
 * same way at each reset between them, to nothing and with no reading there (`zero`).
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
  /** The share spent, «62%», or what a window past its reset leads with instead. */
  valueText: string
  /**
   * What the share's cell says under it in the quiet ink, where it has more to say: past the
   * reset, the share before it, «before the reset: 62%».
   */
  valueDetail?: string
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
 * (`low`) and its faster's (`high`), alike for a forecast of one value. `WindowBar` draws it as one
 * hatched tail past the share spent, to the high end; its words say both.
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

/**
 * Where a window's count restarted inside it, its reset unchanged: the moment of the reading it
 * restarted at, said as its hint, its name and its row of the table say it — what it is, the
 * moment as its figure, and that the reset did not move. `key` names its row of the table.
 */
export interface StepRestart extends StepTarget {
  at: number
  key: string
  /** Its moment in words, the table's first column: «12:05». */
  timeText: string
  /**
   * Whether the count fell to nothing at this moment with no reading there: a window of a line
   * of several reset, and the next one starts from nothing (`stepPath`).
   */
  zero?: boolean
}

/** A reading or a restart of a step line, by its kind and its order among its kind. */
export interface StepStop {
  index: number
  kind: 'reading' | 'restart'
}

/**
 * The readings and restarts a span shows in the order they stand, which is the order the keyboard
 * walks them: by moment, and a restart before the reading at its moment, the one it restarted at,
 * so a reader meets the restart before the share the count restarted from.
 */
export function stepStops(
  readings: readonly { at: number }[],
  restarts: readonly { at: number }[],
): StepStop[] {
  const stops: (StepStop & { at: number })[] = [
    ...restarts.map((restart, index) => ({ at: restart.at, index, kind: 'restart' as const })),
    ...readings.map((point, index) => ({ at: point.at, index, kind: 'reading' as const })),
  ]
  // A stable sort keeps a restart, listed first, before the reading at its moment.
  return stops.sort((left, right) => left.at - right.at).map(({ index, kind }) => ({ index, kind }))
}

/**
 * The fall a restart marks: from the share the line held before its moment (`high`) to the least
 * it reads at it (`low`), as the line draws them, which is where its ring stands. Where no
 * reading stood before it, both ends are at its own reading. A fall to nothing (`zero`), a
 * reset of a line of several windows, ends at 0 whatever reading follows it.
 */
export function restartFall(points: readonly StepPoint[], at: number, zero = false) {
  let held: number | undefined
  const there: number[] = []
  for (const point of points) {
    if (point.at < at) held = point.value
    else if (point.at === at && !zero) there.push(point.value)
  }
  const values = [...(held === undefined ? [] : [held]), ...there, ...(zero ? [0] : [])]
  return values.length
    ? { high: Math.max(...values), low: Math.min(...values) }
    : { high: 0, low: 0 }
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
  /** The share the window stands at now, the line's end. */
  value: number
}

/**
 * The words around a step line: its top, the ends of its axis, «now», what takes a frame back,
 * its table's headings and empty state.
 */
export interface StepWords {
  empty: string
  note: string
  /** What marks now on the line of a running window: «Now». */
  now: string
  /** That the reset a forecast runs to stands past the end of a frame. */
  past: string
  time: string
  /** The value the top of the plot stands for, «100%». */
  top: string
  value: string
  /** What takes a line a frame narrowed back to the whole span it runs over: «Whole span». */
  whole: string
  /**
   * The right end of the whole window's axis where the window named its reset, «resets 16:30», or
   * past it «reset at 16:30»; where unset, the moment alone.
   */
  reset?: string
  /**
   * The left end of the whole window's axis where the window named its start, «start 11:30»;
   * where unset, the moment alone.
   */
  start?: string
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
 * then flat to `end`, the moment the last reading holds to. At each of `zeros` after the first
 * reading the count falls to nothing with no reading there, before a reading at that moment: the
 * reset between two windows of one line. What stands at the frame's start is carried in from its
 * edge, and nothing past its end is drawn. No readings draw no path.
 */
function stepPath(
  frame: StepFrame,
  points: readonly Pick<StepPoint, 'at' | 'value'>[],
  end: number,
  zeros: readonly number[] = [],
): string {
  const first = points[0]
  if (!first) return ''
  // A stable sort keeps a fall to nothing, listed first, before the reading at its moment.
  const turns = [
    ...zeros.filter((at) => at > first.at).map((at) => ({ at, value: 0 })),
    ...points.map(({ at, value }) => ({ at, value })),
  ].sort((left, right) => left.at - right.at)
  let start = 0
  for (const [index, turn] of turns.entries()) if (turn.at <= frame.from) start = index
  const from = turns[start] ?? first
  const parts = [`M${fixed(stepX(frame, from.at))},${fixed(stepY(frame, from.value))}`]
  for (const turn of turns.slice(start + 1)) {
    if (turn.at > frame.to) break
    parts.push(`H${fixed(stepX(frame, turn.at))}`, `V${fixed(stepY(frame, turn.value))}`)
  }
  parts.push(`H${fixed(stepX(frame, Math.max(end, turns.at(-1)?.at ?? end)))}`)
  return parts.join(' ')
}

/**
 * The two parts of a line of several windows: the windows before `live`, the moment the current
 * window starts, which a host draws in the neutral ink of a window past its reset, and the
 * current one from there to `end`, carrying in what stood at `live` where earlier windows went
 * before it. A part outside the frame is empty, so neither leaves a dot at an edge.
 */
export function stepParts(
  frame: StepFrame,
  line: {
    end: number
    live: number
    points: readonly Pick<StepPoint, 'at' | 'value'>[]
    zeros: readonly number[]
  },
) {
  const { end, live, points, zeros } = line
  const before = points.filter((point) => point.at < live)
  const after = points.filter((point) => point.at >= live)
  const last = before.at(-1)
  const earlier = last && live > frame.from ? stepPath(frame, before, live, zeros) : ''
  const fell = last !== undefined && zeros.some((at) => at > last.at && at <= live)
  const carried = last ? [{ at: live, value: fell ? 0 : last.value }] : []
  const later = zeros.filter((at) => at > live)
  const current =
    after.length && live < frame.to ? stepPath(frame, [...carried, ...after], end, later) : ''
  return { current, earlier }
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
 * Where the line of a forecast ends: at the run-out, the first turn past its start where its
 * faster edge reaches the whole window, or at the reset where it never does. Null where it stands
 * at the whole window from its start, a window spent already, which has no line to draw.
 */
function forecastEnd(high: StepCourse): number | null {
  const [start, ...rest] = high
  return !start || start.value >= 100
    ? null
    : (rest.find((turn) => turn.value >= 100) ?? rest.at(-1) ?? start).at
}

/**
 * The part of a forecast a frame shows: each edge as points of the plot, from where it starts, or
 * the frame's start, to where its line ends (`forecastEnd`) or the frame's end before that, and
 * whether the reset stands past the frame's end (`cut`). Null where the frame holds none of it, or
 * there is no line.
 */
export function corridorIn(frame: StepFrame, high: StepCourse, low: StepCourse) {
  const begins = Math.max(frame.from, high[0]?.at ?? Number.POSITIVE_INFINITY)
  const reset = forecastEnd(high) ?? Number.NEGATIVE_INFINITY
  const ends = Math.min(frame.to, reset)
  if (ends <= begins) return null
  const place = (turn: StepTurn): StepPlace => ({
    x: stepX(frame, turn.at),
    y: stepY(frame, turn.value),
  })
  return {
    high: courseIn(high, begins, ends).map((turn) => place(turn)),
    low: courseIn(low, begins, ends).map((turn) => place(turn)),
    // The reset itself, which the forecast's words name, past the frame's end.
    cut: (high.at(-1)?.at ?? Number.NEGATIVE_INFINITY) > frame.to,
    /** The moment the part shown ends. */
    ends,
  }
}
