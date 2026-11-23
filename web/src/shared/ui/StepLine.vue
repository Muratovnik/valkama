<script setup lang="ts">
/**
 * A window's readings over its span: the share spent as steps, flat from one reading to the next
 * and up or down at it, never a slope between them, since a source writes a reading only when a
 * value changed (`windowGeometry`). The last reading holds to `end`, the moment the answer was
 * read; but in a silent window (`silent`) nothing was measured past the last reading, and the line
 * ends there, its round cap on it, with nothing drawn from it to «now» or to the reset, so the
 * line's visible end is a reading, found at its own mark. Beside the steps, where steady use from
 * the window's start would stand at each moment (`even`): a thin line from nothing at the start to
 * the whole at the reset. Past `end`, while the window still runs (`ahead`), its forecast: a dashed
 * line of the readings' width in their hue, the conventional cue of a projection, from where the
 * readings end at now along the faster pace, the one that decides a run-out, as the bar's tail
 * does; where it runs out before the reset the line ends there, on the level of the whole window,
 * and nothing is drawn after it, and where it does not it ends at the reset at its share
 * (`useStepAhead`). A week's range down to its slower pace is a quiet solid fill of the hue under
 * that line, with no hatch and no outline, and none where the range is under a few pixels. The
 * forecast was a hatched band, and five hours that ran out a hatched bar along 100 % to the reset:
 * thick, and read as the level itself.
 *
 * A line may hold windows before the current one (`current`, the current window's span inside the
 * line's): every window of its kind the host's period overlaps, each whole from its start to its
 * reset, one after another, the count falling to nothing at each reset (`restarts` marked `zero`,
 * the mechanism of a count that restarts inside a window), with the current window at the right
 * end. What stands before the current window's start, its line and its readings' marks, is drawn
 * in the neutral ink of a window past its reset, which the legend names apart; the pace runs over
 * the current window alone. Its span (`from`, `to`) may be longer than the windows it holds, a
 * scale a host shares between lines so they are comparable; the line is empty where it holds none,
 * and its axis names the first window's start and the current window's reset under the moments
 * they stand at (`holds`), not the scale's ends, which belong to another line.
 *
 * Every line shows its whole span, from its first window's start to the current window's reset
 * (`from`, `to`), running or past its reset alike (`useStepSpan`), and the axis under it names its
 * two ends for what they are —
 * the window's start and its reset (`words.start`, `words.reset`), dated where they are not on the
 * answer's day, the moment alone where the window did not name one — so its right end is never a
 * bare time that reads as now. While the window runs, now is marked across the plot at the line's
 * end (`end`), with no reading in it as well, where a host draws a window nothing was read in yet, an upright hairline in the quiet ink that the legend names «Now» beside a hair of
 * it, as it names every line the plot draws, with no word over the plot: a silent window's
 * line stops well before it. A window past its reset (`ended`)
 * draws nothing past its readings, and its readings, their marks and their key in the legend in
 * the neutral ink of marks at rest, as its bar is drawn (`WindowBar`'s `muted`), so its last
 * window's line is not read as the share spent now. A frame dragged along the plot with a mouse or
 * a pen (`useAxisFrame`), or stretched from the place the keyboard stands on with Shift and an
 * arrow, narrows this line alone to the moments it covers, the axis then naming its ends by their
 * moments alone, a forecast that runs on past its end cut there; the button in the head takes it
 * back to the whole span (`StepLineHead`). Nothing else on the page follows it.
 *
 * One axis, of percents from 0, its top written once beside the plot, centred on a hairline drawn
 * at its level: 100, or the highest reading where one ran past it, so a line that reaches it meets
 * the line its figure names; written over the plot with nothing at its level, a line at 100 % read
 * as stopping under the mark. What the plot draws is told apart by its drawing — the readings a
 * heavier line in the chart's hue, the pace a hairline in the quiet ink, the forecast a dashed
 * line, now an upright hairline — and a legend names each in the line's head (`StepLineHead`), the
 * forecast while the span shows it and now while it is marked. The pace and the forecast are
 * layers beside the readings, which their keys in the legend turn off and on for every chart at
 * once (`chartLayersStore`): one turned off is not drawn, and no hint or place counts it — the
 * forecast's place goes with its line, and «now» then takes the pointer on to the plot's end —
 * while its key stays. The readings are the data and always show; now and the top's level orient
 * the plot and are no layer.
 *
 * At rest no reading paints its mark: a mark at each reading made a busy window a chain of dots
 * that hid its own steps. The reading under the pointer paints its mark, and so does the one the
 * keyboard stands on for as long as it holds the focus, a pointer passing elsewhere or not, so a
 * forced palette shows it too. Nothing marks the latest reading or the line's end at rest: the
 * window's lead says the share it ends at, and on a window that has been silent for hours a dot at
 * that reading stood far before the line's end and read as now, where a dot at the end would be a
 * reading nobody took. The line's ends are round, so a last step too short to see still leaves its
 * point.
 *
 * No line stands over the plot. Each reading is a mark with its own hint (`markHints.ts`). Past
 * the readings the line has two more places, each with its own hint, and each paints its mark
 * only while it is pointed at or focused, as a reading does. At `end`, «now» (`ahead.now`): the
 * share it stands at, when its latest reading was and how long the window has been silent; its
 * mark is the round dot the forecast's end is drawn with, a ring there having read as a second
 * kind of point on the one line. Where the forecast's
 * line ends, its forecast (`ahead.forecast`): what the slower and the faster pace leave, when the
 * reset is and when the window runs out before it; its mark is a round dot in the line's hue
 * ringed in the ground, at least a reading's dot across, at the line's end (`stepMarks.css`). A
 * flat dash once stood there, which read as no dot at all. Where the span ends before the line
 * does, the dot stands at the plot's end and its hint says the reset stands past it
 * (`words.past`).
 *
 * One layer over the whole field takes the pointer for every place (`vHintPick`), and nothing else
 * in the plot does: not the drawing, not a place's own box. It runs half a mark past each edge of
 * the field, the reach of a mark (`--step-hit`), so a mark centred on an edge is pointed at whole,
 * and it finds the place under the pointer by its x alone (`aimAt`): a mark within that reach
 * wins, a place's — a restart, «now», the forecast — before any reading's, the nearest of several;
 * elsewhere the place whose stretch holds the pointer — a reading's step, from its moment to the
 * next reading's or to `end`, «now» from `end` to the plot's end where no forecast follows, the
 * forecast along its line. So a reader aims at a moment and not at a dot, and a reading a few
 * pixels from the next is still found at its own mark. On a period of weeks the readings stand on
 * every pixel, and a restart on the pixel of the reading before it was never found: a place is an
 * event the pointer can single out, and its hint says the share at its moment. Where two places
 * stand within that reach of each other the pointer finds the nearer, and its hint says the
 * other's words after its own (`hintsWithNearby`); each keeps its own name for the keyboard.
 *
 * Where the window's count restarted inside it (`restarts`), the line falls at a reading, and the
 * restart is a place on the line there with its hint, its mark a round ring on the middle of
 * the fall (`useStepWalk`), found by the pointer before the reading it restarted at.
 *
 * The readings, the restarts and the two places are one stop for Tab, walked with the arrows in
 * the order they stand — the readings, each restart before the reading at its moment, then «now»,
 * then the forecast — each saying itself in its hint and as its name. Tab lands on the latest
 * reading. Each hint lies over the page at its mark, so pointing moves nothing: a reading's at the
 * top right of its dot (`data-hint-point`, `hintPlacement.ts`), a place's beside its mark, level
 * with the mark's top (`data-hint-mark`), so a forecast that runs out at the top of the plot keeps
 * its hint off the line's head. Every reading is also in the figure's name and in its table twin
 * (`StepLineTable`), and so is the forecast. The drawing stretches to its host's width, so its
 * lines keep their width and their dashes (`vector-effect`), and every word and mark is HTML over
 * it rather than SVG the stretch would squash: a dot drawn in the stretched drawing would be an
 * ellipse at every width but one. A forced palette draws the lines, the fill and the marks in its
 * inks.
 *
 * What a reader of the page selects it by: the figure is `data-chart="steps"`, with
 * `data-muted` past its reset; its regions are `data-region` — `head` (`StepLineHead`), `plot`,
 * the `scale`'s figure at its top, the `field` the marks stand in, the `drawing` of its lines,
 * the `hover` layer that takes the pointer, and the `axis`, whose two ends are `data-moment`
 * `from` and `to`; its marks are `data-mark` — the `ceiling` at the top's level, `now` the
 * hairline up the plot, the pace's `even`, the readings' `line` of the current window and
 * `earlier` of those before it, each `reading`'s dot inside its box (`data-reading`, its order),
 * each `place`'s mark inside its box (`data-target`, `restart`, `now` or `reset`, a restart that is
 * a reset between two windows with `data-drop`), its shape `data-shape` — `ring`, or the
 * forecast's `dot` — the forecast's dashed `forecast` and the `range` filled under it.
 * Each reading's and place's box is its stop (`data-stop`, its order), the element its hint and
 * the keyboard's focus belong to.
 */
import { computed, nextTick, ref } from 'vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { useChartLayersStore } from '@/shared/stores/chartLayersStore.ts'
import { hintsWithNearby, readingHint } from '@/shared/ui/markHints.ts'
import StepLineHead from '@/shared/ui/StepLineHead.vue'
import { vHintPick, vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import { FRAME_KEYS } from '@/shared/ui/useAxisFrame.ts'
import { useStepAhead } from '@/shared/ui/useStepAhead.ts'
import type { StepTargetPlace } from '@/shared/ui/useStepAhead.ts'
import { useStepAim } from '@/shared/ui/useStepAim.ts'
import { useStepFrame } from '@/shared/ui/useStepFrame.ts'
import { useStepSpan } from '@/shared/ui/useStepSpan.ts'
import { useStepWalk } from '@/shared/ui/useStepWalk.ts'
import { useStepWindows } from '@/shared/ui/useStepWindows.ts'
import {
  readingsIn,
  STEP_HEIGHT,
  STEP_WIDTH,
  stepAcross,
  stepTop,
  stepX,
  stepY,
} from '@/shared/ui/windowGeometry.ts'
import type {
  StepAhead,
  StepPoint,
  StepRestart,
  StepSpan,
  StepWords,
} from '@/shared/ui/windowGeometry.ts'

const props = defineProps<{
  /** The moment the last reading holds to: when the answer was read. */
  end: number
  /**
   * The span the line runs over, in ms since the epoch: its window's start and its reset, or a
   * span a host shares between lines, which holds them.
   */
  from: number
  /** All the line says, in words, for a reader who cannot see it. */
  label: string
  /** The legend's names of the two lines, of the forecast and of the windows before the current. */
  legend: { line: string; ahead?: string; earlier?: string; even?: string }
  points: readonly StepPoint[]
  to: number
  words: StepWords
  /** What the line draws past its last reading, the window now and its forecast; none past the reset. */
  ahead?: StepAhead | null
  /**
   * The current window, its start and its reset, where the line holds windows before it or runs
   * over a span longer than it: the pace runs over it alone, and what stands before its start is
   * drawn in the neutral ink of a window past its reset. Unset, the line's span.
   */
  current?: StepSpan
  /**
   * Whether the window is past its reset: drawn in the neutral ink, as its bar is, with nothing
   * past its readings.
   */
  ended?: boolean
  /** Whether to draw where steady use would stand: from 0 at `from` to 100 at `to`. */
  even?: boolean
  /**
   * The moments the line's windows cover, from the first one's start to the current one's reset,
   * where the span is a scale longer than them: the axis names those two ends under the moments
   * they stand at. Unset, the line's span.
   */
  holds?: StepSpan
  /** Where the window's count restarted inside it, each at the moment of one of `points`. */
  restarts?: readonly StepRestart[]
  /**
   * Whether nothing was measured past the last reading, so the line ends there rather than
   * holding to `end`. A source writes a reading only when a value changes, so a fresh window's
   * line holds.
   */
  silent?: boolean
  /** A moment as the axis names an end of a frame, or of a window whose words name none, «14:05». */
  moment: (at: number) => string
}>()

const span = useStepSpan(() => props)
const { framed, shown, whole } = span

const frame = computed(() => ({ ...shown.value, top: stepTop(props.points) }))
const readings = computed(() => readingsIn(shown.value, props.points))
const layers = useChartLayersStore()
/** The windows the line holds, its two parts, and the pace over the current one. */
const { earlier, evenDrawn, evenLine, path, zeros } = useStepWindows(() => props, frame, {
  evenShown: () => layers.shown('even'),
  whole,
})

/**
 * How far down the drawing a mark stands, as a share of its height: the mark stands in its
 * reading's step, at the step's start, and the drawing in the field less its inset.
 */
const markStyle = (point: StepPoint) => ({
  '--step-down': stepY(frame.value, point.value) / STEP_HEIGHT,
})

/**
 * Where the step a reading shown holds ends: at the next reading, or at the reset its window falls
 * to nothing at before it, or at `end` for the last.
 */
function stepEnd(index: number) {
  const point = readings.value.inside[index]
  if (!point) return props.end
  const next = props.points[props.points.indexOf(point) + 1]
  const fall = zeros.value.find((at) => at > point.at)
  const until = next ? next.at : Math.max(props.end, point.at)
  return fall === undefined ? until : Math.min(until, fall)
}

/**
 * The forecast past the readings, its line and the fill of its range, whether the span has one for
 * the legend to name, and the places past them; none of the forecast while its layer is off.
 */
const {
  fill: forecastFill,
  named: corridorNamed,
  nowShown,
  path: forecastPath,
  targets,
} = useStepAhead(
  () => props,
  frame,
  () => layers.shown('ahead'),
)
/**
 * How far along the plot now stands, from 0 to 1, where the line marks it; null where it does not.
 * A running window with no reading in it marks now too: a host's empty current window, on one time
 * axis with a neighbour that has readings, marks it where that one does.
 */
const nowX = computed(() => {
  const empty = !props.ended && !props.points.length
  const inside = props.end >= frame.value.from && props.end <= frame.value.to
  return nowShown.value || (empty && inside) ? stepX(frame.value, props.end) : null
})
/** The words of now's key in the legend while the plot marks now. */
const nowKey = computed(() => (nowX.value === null ? undefined : props.words.now))
/** Whether a frame narrows the line, so its axis names the frame's moments and the head a way back. */
const narrowed = computed(() => framed.value !== null)
/** The figure's hook past its reset: present, or absent rather than false. */
const mutedMark = computed(() => props.ended || undefined)
/**
 * The axis's two ends: the window's start and its reset, said as the window's words name them,
 * or a frame's moments alone.
 */
const ends = computed(() => ({
  from: (!narrowed.value && props.words.start) || props.moment(shown.value.from),
  to: (!narrowed.value && props.words.reset) || props.moment(shown.value.to),
}))
/**
 * Where the axis's two ends stand: under the moments the line's windows start and reset at, inset
 * from the plot's ends by what a shared scale holds past them (`--axis-start`, `--axis-end`, the
 * room before and after them, which gives way where the two words would not fit between); a
 * frame's at the plot's ends.
 */
const axisStyle = computed(() => {
  const held = props.holds
  if (narrowed.value || !held) return {}
  return {
    '--axis-start': stepAcross(frame.value, held.from),
    '--axis-end': `${100 - (stepX(frame.value, held.to) / STEP_WIDTH) * 100}%`,
  }
})
/** Whether «now» stands where the last reading's step ends, and takes the pointer from there on. */
const nowFollows = computed(() => targets.value.some(({ kind }) => kind === 'now'))

/**
 * The box of the step a reading holds, which the keyboard's ring is drawn on: from its moment to
 * the next reading's, or to `end` for the last; at least a ring's width, but for the last reading
 * where «now» follows it, whose own box starts at `end`.
 */
function stepStyle(index: number) {
  const point = readings.value.inside[index]
  if (!point) return {}
  const start = stepX(frame.value, point.at)
  const stop = stepX(frame.value, stepEnd(index))
  const last = !props.points[props.points.indexOf(point) + 1]
  return {
    insetInlineStart: stepAcross(frame.value, point.at),
    inlineSize: `${(Math.max(0, stop - start) / STEP_WIDTH) * 100}%`,
    minInlineSize: last && nowFollows.value ? '0' : undefined,
  }
}
/** The box a place past the readings stands in, which the keyboard's ring is drawn on. */
const reachStyle = ({ reach }: StepTargetPlace) => ({
  insetInlineStart: reach.start,
  insetInlineEnd: reach.end ?? 'auto',
  inlineSize: reach.size ?? 'auto',
})
/**
 * The class of a place's mark by its kind, written whole: a class composed from a template hides
 * from a search, and from the guard over the tests' selectors, which class the line writes.
 */
const PLACE_MARK = {
  now: 'step-now-mark',
  reset: 'step-reset-mark',
  restart: 'step-restart-mark',
} as const

/** A restart's hook where it is a reset between two windows of the line: present, or absent. */
const dropMark = ({ zero }: StepTargetPlace) => zero || undefined

/** The shape of a place's mark: a ring for a restart, a round dot for «now» and the forecast. */
const markShape = ({ kind }: StepTargetPlace) => (kind === 'restart' ? 'ring' : 'dot')

/** Where a place's mark stands, as its style: its top and its foot, at its stretch's side. */
const targetMark = ({ mark }: StepTargetPlace) => ({
  '--step-high': mark.high,
  '--step-low': mark.low,
  '--step-side': mark.side,
})

/** Every place in the order the keyboard walks them: the readings, the restarts, those past. */
const walk = useStepWalk(() => props, frame, {
  inside: () => readings.value.inside,
  past: () => targets.value,
  step: (index) => ({ from: readings.value.inside[index]?.at ?? 0, to: stepEnd(index) }),
})
const { coveredBy, places, readingStop } = walk

/** The place under the pointer or the keyboard, its mark painted. */
const pointed = ref<number | null>(null)
const markClass = (index: number) => ({ 'step-shown': pointed.value === index })
/** A reading's mark's classes: pointed at, and in the neutral ink before the current window. */
const readingClass = (point: StepPoint, index: number) => ({
  ...markClass(index),
  'step-earlier': earlier(point),
})
/**
 * A place's mark's classes: its kind, pointed at, and in the neutral ink where it is of a window
 * before the current one, as that window's readings are: a reset between two windows, which ends
 * the one before, and a restart inside one.
 */
const placeClass = (target: StepTargetPlace & { stop: number; at?: number }) => [
  PLACE_MARK[target.kind],
  markClass(target.stop),
  {
    'step-earlier': Boolean(target.zero) || (target.at !== undefined && earlier({ at: target.at })),
  },
]

/** The one place Tab lands on: the last stood on while it is still there, else the latest reading. */
const stood = ref<number | null>(null)
const stop = computed(() => {
  const latest = readingStop(Math.max(0, readings.value.inside.length - 1))
  return stood.value !== null && stood.value < walk.count.value ? stood.value : latest
})

const field = ref<HTMLElement | null>(null)
/** The one layer that takes the pointer, half a mark past each edge of the field. */
const hover = ref<HTMLElement | null>(null)
const { near, pickAt, placeAt } = useStepAim({ field, hover }, frame, () => walk.aims.value)
/** Each place's hint, with the words of the places within a mark's reach of it. */
const placeHints = computed(() => hintsWithNearby(places.value, near))
const { framing, keys } = useStepFrame(field, { coveredBy, frame, narrow: span.narrow })

/** The line back on its whole window, the keyboard's place on it kept in the page's order. */
async function takeBack() {
  span.back()
  await nextTick()
  moveFocus(field.value?.querySelector<HTMLElement>(`[data-stop="${stop.value}"]`))
}

const MOVES: Record<string, (at: number, last: number) => number> = {
  ArrowLeft: (at) => Math.max(0, at - 1),
  ArrowRight: (at, last) => Math.min(last, at + 1),
  Home: () => 0,
  End: (_, last) => last,
}

/**
 * A key on a place: the arrows, Home and End walk the readings and the places past them, and
 * Shift with an arrow stretches the frame from the place stood on as it walks (`useKeyFrame`).
 */
async function move(event: KeyboardEvent) {
  const count = walk.count.value
  if (!count) return
  const stretched = keys.stretch(event, stop.value, count)
  const to = MOVES[event.key]
  if (stretched === null && !to) return
  event.preventDefault()
  stood.value = stretched ?? to?.(stop.value, count - 1) ?? stop.value
  await nextTick()
  moveFocus(field.value?.querySelector<HTMLElement>(`[data-stop="${stood.value}"]`))
}

/** Only the place Tab lands on is in the page's order; the arrows reach the rest. */
const tabOf = (index: number) => (index === stop.value ? 0 : -1)

function stand(index: number) {
  stood.value = index
  pointed.value = index
}
</script>

<template>
  <figure
    class="step-line"
    data-chart="steps"
    :class="{ 'step-muted': ended }"
    :data-muted="mutedMark"
    :aria-label="label"
    data-hint-frame
  >
    <StepLineHead
      :framed="narrowed"
      :whole="words.whole"
      :legend="legend"
      :ahead="corridorNamed"
      :even="even"
      :muted="ended"
      :now="nowKey"
      :earlier="Boolean(path.earlier)"
      @whole="takeBack"
    />
    <div
      class="step-plot"
      data-region="plot"
    >
      <span
        class="step-top"
        aria-hidden="true"
        data-region="scale"
        >{{ words.top }}</span
      >
      <div
        ref="field"
        class="step-field"
        data-region="field"
      >
        <p
          v-if="!points.length"
          class="step-empty"
        >
          {{ words.empty }}
        </p>
        <svg
          class="step-svg"
          data-region="drawing"
          preserveAspectRatio="none"
          focusable="false"
          aria-hidden="true"
          :viewBox="`0 0 ${STEP_WIDTH} ${STEP_HEIGHT}`"
        >
          <line
            class="step-floor"
            x1="0"
            vector-effect="non-scaling-stroke"
            :y1="STEP_HEIGHT"
            :x2="STEP_WIDTH"
            :y2="STEP_HEIGHT"
          />
          <line
            class="step-ceiling"
            data-mark="ceiling"
            x1="0"
            y1="0"
            y2="0"
            vector-effect="non-scaling-stroke"
            :x2="STEP_WIDTH"
          />
          <line
            v-if="nowX !== null"
            class="step-now"
            data-mark="now"
            y1="0"
            vector-effect="non-scaling-stroke"
            :x1="nowX"
            :x2="nowX"
            :y2="STEP_HEIGHT"
          />
          <line
            v-if="evenDrawn"
            class="step-even"
            data-mark="even"
            vector-effect="non-scaling-stroke"
            :x1="evenLine.x1"
            :y1="evenLine.y1"
            :x2="evenLine.x2"
            :y2="evenLine.y2"
          />
          <path
            v-if="forecastFill"
            class="step-range"
            data-mark="range"
            :d="forecastFill"
          />
          <path
            v-if="path.earlier"
            class="step-path step-path-earlier"
            data-mark="earlier"
            vector-effect="non-scaling-stroke"
            :d="path.earlier"
          />
          <path
            v-if="path.current"
            class="step-path"
            data-mark="line"
            vector-effect="non-scaling-stroke"
            :d="path.current"
          />
          <path
            v-if="forecastPath"
            class="step-forecast"
            data-mark="forecast"
            vector-effect="non-scaling-stroke"
            :d="forecastPath"
          />
        </svg>
        <!-- A reading is a picture of its moment and value, walked with the arrows as one stop. -->
        <!-- Its mark is the point its hint speaks for; the layer below takes the pointer for it. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <span
          v-for="(point, index) in readings.inside"
          :key="point.key"
          v-tooltip.detail="readingHint(point, 1)"
          class="step-reach"
          role="img"
          :aria-keyshortcuts="FRAME_KEYS"
          :data-reading="index"
          :data-stop="readingStop(index)"
          :tabindex="tabOf(readingStop(index))"
          :style="stepStyle(index)"
          @focus="stand(readingStop(index))"
          @blur="pointed = null"
          @keydown="move"
          @keyup="keys.release"
          ><span
            class="step-mark"
            aria-hidden="true"
            data-mark="reading"
            :class="readingClass(point, readingStop(index))"
            :data-key="point.key"
            :style="markStyle(point)"
            data-hint-point
        /></span>
        <!-- The restarts among the readings, then «now» and the forecast, each a picture of what -->
        <!-- it says, walked in the order they stand. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <span
          v-for="(target, index) in places"
          :key="target.key"
          v-tooltip.detail="placeHints[index]"
          class="step-target"
          role="img"
          :aria-keyshortcuts="FRAME_KEYS"
          :data-target="target.kind"
          :data-drop="dropMark(target)"
          :data-stop="target.stop"
          :tabindex="tabOf(target.stop)"
          :style="reachStyle(target)"
          @focus="stand(target.stop)"
          @blur="pointed = null"
          @keydown="move"
          @keyup="keys.release"
          ><span
            class="step-target-mark"
            aria-hidden="true"
            data-mark="place"
            :class="placeClass(target)"
            :data-shape="markShape(target)"
            :style="targetMark(target)"
            data-hint-mark
        /></span>
        <!-- The one layer that takes the pointer for every place: a picture of none, so hidden. -->
        <span
          ref="hover"
          v-hint-pick="pickAt"
          class="step-hover"
          aria-hidden="true"
          data-region="hover"
          @pointermove="pointed = placeAt($event.clientX)"
          @pointerleave="pointed = null"
        />
        <span
          v-if="framing"
          class="axis-frame step-span"
          aria-hidden="true"
          :style="{ insetInlineStart: framing.start, inlineSize: framing.size }"
        />
      </div>
      <div
        class="step-axis"
        aria-hidden="true"
        data-region="axis"
        :style="axisStyle"
      >
        <span data-moment="from">{{ ends.from }}</span>
        <span data-moment="to">{{ ends.to }}</span>
      </div>
    </div>
  </figure>
</template>

<style scoped src="@/shared/ui/axisFrame.css"></style>

<style scoped src="@/shared/ui/stepMarks.css"></style>

<style scoped src="@/shared/ui/stepPlot.css"></style>

<style scoped>
/* Its head over its plot, each at the top of its row, which a host that lays the line on rows it
   shares with a neighbour may make taller than it. */
.step-line {
  display: grid;
  gap: var(--space-2);
  align-items: start;
  min-inline-size: 0;
  margin: 0;
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}
</style>
