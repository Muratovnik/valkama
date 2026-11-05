/**
 * What a comet does on a line of a given length, all of it in the field's own units, so
 * it scales with the field and looks the same on every line at one zoom.
 *
 * One dash of `COMET_LENGTH` travels at `COMET_SPEED`. Its pattern repeats every `period`,
 * and a pass moves it by exactly one period: on a line the comet crosses in one pass, the
 * period is the line and the comet together, so it enters at the line's start, leaves into
 * the arrow, and no other dash is in sight when the pass begins again.
 *
 * A pass on a long line would leave that line bare for most of its time: a line across a
 * large map is thousands of units long, half a minute at this speed. So no two comets are
 * further apart than `COMET_SPACING`, and a longer line carries the next one on the way,
 * of the same length and speed, rather than hurrying one. The same picture stands at both
 * ends of the pass then, so beginning again jumps nowhere.
 */

/** Shorter than the shortest line the layout routes between two cards, 64 units. */
const COMET_LENGTH = 32
/** Units a second: what the old fixed pass made of a line of a typical length. */
const COMET_SPEED = 160
/** Eight seconds apart: at the zoom a field opens on, one screen's height of a line. */
const COMET_SPACING = 1280

export interface CometRun {
  dash: number
  /** The dash offset a pass runs from. */
  from: number
  gap: number
  seconds: number
  /** The dash offset a pass runs to. */
  to: number
}

export function cometRun(lineLength: number): CometRun {
  const period = Math.min(lineLength + COMET_LENGTH, COMET_SPACING)
  return {
    dash: COMET_LENGTH,
    gap: period - COMET_LENGTH,
    from: COMET_LENGTH,
    to: COMET_LENGTH - period,
    seconds: period / COMET_SPEED,
  }
}
