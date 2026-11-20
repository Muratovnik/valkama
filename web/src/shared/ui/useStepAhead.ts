/**
 * What a step line draws and points at past its readings (`StepLine`): the corridor of its
 * forecast in the span shown, as the outline its hatch is cut to, and the two places a reader
 * points at there — «now» where the line ends, and the forecast where the corridor ends — each
 * with its hint, where the pointer finds it (`aim`), the box the keyboard's ring is drawn on,
 * where its mark stands and the moments it covers for a frame stretched with the keyboard.
 *
 * The pointer finds «now» at its ring, and without a corridor along the rest of the plot from the
 * line's end; the forecast at its mark and along the corridor. The forecast's mark stands at the
 * corridor's end, which is the plot's end, the reset or where a frame ends before it; there its
 * hint says the reset stands past it (`words.past`). A place's box, which the keyboard's ring
 * is drawn on, starts at the place: «now»'s is the least width of a box (`--step-reach`) over a
 * corridor, and that width before the plot's end where «now» stands there; the forecast's starts
 * past «now»'s and runs to the plot's end.
 *
 * The forecast is a layer beside the readings, which its key in the legend turns off and on for
 * every chart (`shows`, `chartLayersStore`): turned off, neither its corridor nor its place is
 * there, and «now» takes the pointer on to the plot's end as it does where no corridor follows;
 * the legend still names it, so it can be turned on again (`named`).
 */
import { computed } from 'vue'
import type { ComputedRef } from 'vue'

import { targetHint } from '@/shared/ui/markHints.ts'
import {
  corridorIn,
  STEP_HEIGHT,
  STEP_WIDTH,
  stepAcross,
  stepX,
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
  /** «Now», the forecast at the reset, or a restart of the count on the line (`useStepWalk`). */
  kind: 'now' | 'reset' | 'restart'
  /**
   * Where its mark stands: from the top of what it marks (`high`) to its foot (`low`), as shares
   * of the drawing's height, one place for «now», and at its stretch's start, middle or end
   * (`side`).
   */
  mark: { high: number; low: number; side: '0%' | '50%' | '100%' }
  /**
   * The box the keyboard's ring is drawn on: from `start` to the plot's end, or `size` wide from
   * `start`, or the last `size` of the plot where it has no `start`.
   */
  reach: { size: string | null; start: string | null }
}

/**
 * A place of the corridor's outline over the field: its share across, and its height in the
 * drawing, which stands in the field less its inset, half a ribbon above an edge (`-`) or below.
 */
const outline = ({ x, y }: StepPlace, side: '-' | '+') =>
  `${(x / STEP_WIDTH) * 100}% calc(var(--step-inset) + (100% - 2 * var(--step-inset)) * ${
    y / STEP_HEIGHT
  } ${side} var(--step-ribbon))`

export function useStepAhead(
  line: () => {
    /** The moment the line ends: now. */
    end: number
    points: readonly unknown[]
    words: StepWords
    ahead?: StepAhead | null
  },
  frame: ComputedRef<StepFrame>,
  /** Whether the forecast's layer is on, so its corridor and its place are drawn. */
  shows: () => boolean,
) {
  /** The forecast's corridor in the span shown, in the plot's units; none where it shows none. */
  const inSpan = computed(() => {
    const { ahead, points } = line()
    const forecast = ahead?.forecast
    return forecast && points.length ? corridorIn(frame.value, forecast.high, forecast.low) : null
  })
  /** The corridor as the plot draws it: none while the forecast's layer is off. */
  const corridor = computed(() => (shows() ? inSpan.value : null))

  /**
   * The corridor as the outline of its hatch over the field: its faster edge half a ribbon
   * higher and its slower edge as much lower, so a range said alike is never a hairline.
   */
  const clip = computed(() => {
    const drawn = corridor.value
    if (!drawn) return null
    const edge = drawn.high.map((place) => outline(place, '-'))
    const back = [...drawn.low].reverse().map((place) => outline(place, '+'))
    return `polygon(${[...edge, ...back].join(', ')})`
  })

  /**
   * Whether the line's end, now, stands in the span shown, with a line to end there: a running
   * window's, which marks it (`StepLine`).
   */
  const nowShown = computed(() => {
    const { ahead, end, points } = line()
    return Boolean(ahead && points.length && end >= frame.value.from && end <= frame.value.to)
  })

  /** «Now», where the line ends: from there to the corridor, or to the plot's end without one. */
  function nowTarget(ahead: StepAhead): StepTargetPlace {
    const { end } = line()
    const atEnd = stepX(frame.value, end) >= STEP_WIDTH
    const down = stepY(frame.value, ahead.value) / STEP_HEIGHT
    return {
      kind: 'now',
      hint: targetHint(ahead.now, 1),
      reach: {
        start: atEnd ? null : stepAcross(frame.value, end),
        size: atEnd || corridor.value ? 'var(--step-reach)' : null,
      },
      mark: { high: down, low: down, side: atEnd ? '100%' : '0%' },
      aim: { at: end, from: end, to: corridor.value ? end : frame.value.to },
      covers: { from: end, to: end },
    }
  }

  /** The forecast, where the corridor ends: along the corridor past «now», its mark at the end. */
  function resetTarget(ahead: StepAhead): StepTargetPlace | null {
    const forecast = ahead.forecast
    const drawn = corridor.value
    const high = drawn?.high.at(-1)
    const low = drawn?.low.at(-1)
    if (!forecast || !drawn || !high || !low) return null
    const begins = Math.max(line().end, frame.value.from)
    const ends = Math.min(frame.value.to, forecast.high.at(-1)?.at ?? begins)
    const after = nowShown.value ? ' + var(--step-reach)' : ''
    return {
      kind: 'reset',
      hint: targetHint(forecast, 1, drawn.cut ? [line().words.past] : []),
      reach: {
        start: `min(calc(${stepAcross(frame.value, begins)}${after}), calc(100% - var(--step-reach)))`,
        size: null,
      },
      mark: { high: high.y / STEP_HEIGHT, low: low.y / STEP_HEIGHT, side: '100%' },
      aim: { at: ends, from: begins, to: ends },
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

  /** Whether the span shown has a corridor, drawn or turned off, so the legend names it. */
  const named = computed(() => inSpan.value !== null)

  return { clip, named, nowShown, targets }
}
