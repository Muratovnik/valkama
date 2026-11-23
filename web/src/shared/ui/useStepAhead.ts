/**
 * What a step line draws and points at past its readings (`StepLine`): its forecast in the span
 * shown, as a dashed line and the quiet fill of its range under it in the plot's own units, and
 * the two places a reader points at there — «now» where the readings' line ends, and the forecast
 * where its line ends — each with its hint, where the pointer finds it (`aim`), the box the
 * keyboard's ring is drawn on, where its mark stands and the moments it covers for a frame
 * stretched with the keyboard.
 *
 * The forecast's line follows its faster edge from now, the pace that decides a run-out as the
 * bar's tail does, and ends where it runs out, on the level of the whole window, or at the reset
 * at its share where it does not (`forecastEnd`): past a run-out nothing is drawn, since the run-out
 * is the fact the window's words say and a stretch flat along 100 % to the reset only thickened that
 * level. A week's range down to its slower edge is a fill under the line, where it is at least
 * `FILL_LEAST` of the drawing tall somewhere; under that it reads as the line's own width.
 *
 * The pointer finds «now» at its dot, and without a forecast along the rest of the plot from the
 * line's end; the forecast at its dot and along its line. The dot stands at the line's end, the
 * run-out, the reset or where a frame ends before them; there its hint says the reset stands past
 * it (`words.past`). A place's box, which the keyboard's ring is drawn on, has its middle where the
 * pointer finds the place: «now»'s is the least width of a box (`--step-reach`) with its middle on
 * its dot (`reachAround`), as a restart's is on its ring; the forecast's runs along its line from past
 * «now»'s to half that width past its dot, and where the line is shorter than that width it is
 * that width with its middle on the dot. A box that started at «now» or ended at the dot put its
 * middle 12px off the mark, where on a dense period the forecast's line or a reading took the
 * pointer.
 *
 * The forecast is a layer beside the readings, which its key in the legend turns off and on for
 * every chart (`shows`, `chartLayersStore`): turned off, neither its line nor its place is there,
 * and «now» takes the pointer on to the plot's end as it does where no forecast follows; the
 * legend still names it, so it can be turned on again (`named`).
 */
import { computed } from 'vue'
import type { ComputedRef } from 'vue'

import { targetHint } from '@/shared/ui/markHints.ts'
import {
  corridorIn,
  reachAround,
  STEP_HEIGHT,
  STEP_WIDTH,
  stepAcross,
  stepY,
} from '@/shared/ui/windowGeometry.ts'
import type {
  StepAhead,
  StepAim,
  StepFrame,
  StepPlace,
  StepSpan,
  StepWords,
} from '@/shared/ui/windowGeometry.ts'

/** A place past the readings: which, its hint, where the pointer finds it, its box and its mark. */
export interface StepTargetPlace {
  /** Where the pointer finds it: at its mark, or along its stretch where no mark is near. */
  aim: StepAim
  /** The moments it covers, for a frame stretched to it with the keyboard. */
  covers: StepSpan
  hint: ReturnType<typeof targetHint>
  /** «Now», the forecast at its end, or a restart of the count on the line (`useStepWalk`). */
  kind: 'now' | 'reset' | 'restart'
  /**
   * Where its mark stands: from the top of what it marks (`high`) to its foot (`low`), as shares
   * of the drawing's height, one place for «now» and the forecast, and across its box (`side`):
   * the middle, or half the least width of a box before its end.
   */
  mark: { high: number; low: number; side: '50%' | typeof BEFORE_END }
  /**
   * The box the keyboard's ring is drawn on: `size` wide from `start`, or from `start` to `end`
   * from the plot's end.
   */
  reach: { start: string } & ({ size: string; end?: never } | { end: string; size?: never })
  /** Whether a restart is a reset between two windows of the line, its count falling to nothing. */
  zero?: boolean
}

/**
 * How tall a forecast's range must stand somewhere, in the drawing's units, for its fill to be
 * drawn: the drawing is a fixed 82px tall (`stepPlot.css`), so three and a half of its hundred
 * units are about three pixels, a pixel past the line's own width under it; a thinner range only
 * reads as a second edge of the line.
 */
const FILL_LEAST = 3.5

/** Where the forecast's dot stands in its box, which runs half the least width of a box past it. */
const BEFORE_END = 'calc(100% - var(--step-reach) / 2)'

/** Points of the plot as a path's moves: to the first, then a line to each next. */
const traced = (places: readonly StepPlace[]) =>
  places.map(({ x, y }, index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ')

export function useStepAhead(
  line: () => {
    /** The moment the line ends: now. */
    end: number
    points: readonly unknown[]
    words: StepWords
    ahead?: StepAhead | null
  },
  frame: ComputedRef<StepFrame>,
  /** Whether the forecast's layer is on, so its line and its place are drawn. */
  shows: () => boolean,
) {
  /** The forecast in the span shown, in the plot's units; none where it shows none. */
  const inSpan = computed(() => {
    const { ahead, points } = line()
    const forecast = ahead?.forecast
    return forecast && points.length ? corridorIn(frame.value, forecast.high, forecast.low) : null
  })
  /** The forecast as the plot draws it: none while its layer is off. */
  const corridor = computed(() => (shows() ? inSpan.value : null))

  /** The forecast's dashed line along its faster edge, as a path of the drawing. */
  const path = computed(() => (corridor.value ? traced(corridor.value.high) : null))

  /**
   * The fill of the range under the line, down to the slower edge and back, as a closed path of
   * the drawing; none where the range is never `FILL_LEAST` tall.
   */
  const fill = computed(() => {
    const drawn = corridor.value
    if (!drawn) return null
    const tallest = Math.max(...drawn.low.map((low, index) => low.y - (drawn.high[index]?.y ?? 0)))
    return tallest >= FILL_LEAST
      ? `${traced([...drawn.high, ...[...drawn.low].reverse()])} Z`
      : null
  })

  /**
   * Whether the line's end, now, stands in the span shown, with a line to end there: a running
   * window's, which marks it (`StepLine`).
   */
  const nowShown = computed(() => {
    const { ahead, end, points } = line()
    return Boolean(ahead && points.length && end >= frame.value.from && end <= frame.value.to)
  })

  /**
   * «Now», where the line ends, its box around its dot; the pointer finds it there, and without a
   * forecast along the rest of the plot.
   */
  function nowTarget(ahead: StepAhead): StepTargetPlace {
    const { end } = line()
    const down = stepY(frame.value, ahead.value) / STEP_HEIGHT
    return {
      kind: 'now',
      hint: targetHint(ahead.now, 1),
      reach: reachAround(frame.value, end),
      mark: { high: down, low: down, side: '50%' },
      aim: { at: end, from: end, to: corridor.value ? end : frame.value.to, place: true },
      covers: { from: end, to: end },
    }
  }

  /**
   * The forecast, where its line ends: along the line past «now», its dot at the line's end, at
   * the run-out on the level of the whole window or at the reset at its share.
   */
  function resetTarget(ahead: StepAhead): StepTargetPlace | null {
    const forecast = ahead.forecast
    const drawn = corridor.value
    const high = drawn?.high.at(-1)
    if (!forecast || !drawn || !high) return null
    const begins = Math.max(line().end, frame.value.from)
    const { ends } = drawn
    const after = nowShown.value ? ' + var(--step-reach) / 2' : ''
    const across = (high.x / STEP_WIDTH) * 100
    const down = high.y / STEP_HEIGHT
    return {
      kind: 'reset',
      hint: targetHint(forecast, 1, drawn.cut ? [line().words.past] : []),
      reach: {
        start: `min(calc(${stepAcross(frame.value, begins)}${after}), calc(${across}% - var(--step-reach) / 2))`,
        end: `calc(${100 - across}% - var(--step-reach) / 2)`,
      },
      mark: { high: down, low: down, side: BEFORE_END },
      aim: { at: ends, from: begins, to: ends, place: true },
      covers: { from: begins, to: ends },
    }
  }

  /** The places past the readings, in the order the keyboard walks them: «now», the forecast. */
  const targets = computed<StepTargetPlace[]>(() => {
    const { ahead } = line()
    if (!ahead) return []
    const reset = resetTarget(ahead)
    return [...(nowShown.value ? [nowTarget(ahead)] : []), ...(reset ? [reset] : [])]
  })

  /** Whether the span shown has a forecast, drawn or turned off, so the legend names it. */
  const named = computed(() => inSpan.value !== null)

  return { fill, named, nowShown, path, targets }
}
