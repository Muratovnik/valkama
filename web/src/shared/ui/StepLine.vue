<script setup lang="ts">
/**
 * A window's readings over its span: the share spent as steps, flat from one reading to the next
 * and up or down at it, never a slope between them, since a source writes a reading only when a
 * value changed (`windowGeometry`). The last reading holds to `end`, the moment the answer was
 * read; but in a silent window (`silent`) nothing was measured past the last reading, and the line
 * ends there, its round cap on it, with nothing drawn from it to «now» or to the reset, so the
 * line's visible end is a reading, found at its own mark. Beside the steps, where steady use from
 * the window's start would stand at each moment (`even`): a thin line from nothing at the start to
 * the whole at the reset. Past `end`, while the window still runs (`ahead`), the corridor of its
 * forecast: from the share it stands at now to where its slower and its faster pace leave it at
 * the reset, a band in the readings' hue under the one hatch of a figure not final yet
 * (`hatch.css`); a forecast of one value is a ribbon of the same hatch, flat along the top from
 * where it runs out. The band keeps half a ribbon's width outside each edge, so its start at now
 * and a range said alike are never a hairline.
 *
 * Every line shows its whole window, from its start to its reset (`from`, `to`), running or past
 * its reset alike (`useStepSpan`), and the axis under it names its two ends for what they are —
 * the window's start and its reset (`words.start`, `words.reset`), dated where they are not on the
 * answer's day, the moment alone where the window did not name one — so its right end is never a
 * bare time that reads as now. While the window runs, now is marked across the plot at the line's
 * end (`end`), an upright hairline in the quiet ink that the legend names «Now» beside a hair of
 * it, as it names every line the plot draws, with no word over the plot: a silent window's
 * line stops well before it. A window past its reset (`ended`)
 * draws nothing past its readings, and its readings, their marks and their key in the legend in
 * the neutral ink of marks at rest, as its bar is drawn (`WindowBar`'s `muted`), so its last
 * window's line is not read as the share spent now. A frame dragged along the plot with a mouse or
 * a pen (`useAxisFrame`), or stretched from the place the keyboard stands on with Shift and an
 * arrow, narrows this line alone to the moments it covers, the axis then naming its ends by their
 * moments alone, a corridor that runs on past its end cut there; the button in the head takes it
 * back to the whole window (`StepLineHead`). Nothing else on the page follows it.
 *
 * One axis, of percents from 0, its top written once beside the plot, centred on a hairline drawn
 * at its level: 100, or the highest reading where one ran past it, so a line that reaches it meets
 * the line its figure names; written over the plot with nothing at its level, a line at 100 % read
 * as stopping under the mark. What the plot draws is told apart by its drawing — the readings a
 * heavier line in the chart's hue, the pace a hairline in the quiet ink, the forecast a hatched
 * band, now an upright hairline — and a legend names each in the line's head (`StepLineHead`), the
 * forecast while the span shows it and now while it is marked.
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
 * mark is a ring rather than a reading's dot, so it never reads as a reading. Where the corridor
 * ends, its forecast at the reset (`ahead.forecast`): what the slower and the faster pace leave,
 * when the reset is and when the window runs out before it; its mark is no ring but a bar at the
 * band's end from the forecast's high end to its low, or for a forecast of one value a dash at it,
 * neither a reading's dot (`stepMarks.css`). Where the span ends before the reset, that mark
 * stands at the plot's end, where the band runs on, and its hint says the reset stands past it
 * (`words.past`).
 *
 * One layer over the whole field takes the pointer for every place (`vHintPick`), and nothing else
 * in the plot does: not the drawing, not a place's own box. It runs half a mark past each edge of
 * the field, the reach of a mark (`--step-hit`), so a mark centred on an edge is pointed at whole,
 * and it finds the place under the pointer by its x alone (`aimAt`): a mark within that reach, the
 * nearest of several, wins; elsewhere the place whose stretch holds the pointer — a reading's
 * step, from its moment to the next reading's or to `end`, «now» from `end` to the plot's end
 * where no corridor follows, the forecast along the corridor. So a reader aims at a moment and not
 * at a dot, and a reading a few pixels from the next is still found at its own mark.
 *
 * Where the window's count restarted inside it (`restarts`), the line falls at a reading, and the
 * restart is a place on the line there with its hint, its mark a ring around the fall
 * (`useStepWalk`), found by the pointer before the reading it restarted at.
 *
 * The readings, the restarts and the two places are one stop for Tab, walked with the arrows in
 * the order they stand — the readings, each restart before the reading at its moment, then «now»,
 * then the forecast — each saying itself in its hint and as its name. Tab lands on the latest
 * reading. Each hint lies over the page at its mark, so pointing moves nothing: a reading's at the
 * top right of its dot (`data-hint-point`, `hintPlacement.ts`), a place's beside its mark, level
 * with the mark's top (`data-hint-mark`), so a forecast that runs out at the top of the plot keeps
 * its hint off the line's head. Every reading is also in the figure's name and in its table twin
 * (`StepLineTable`), and so is the forecast. The drawing stretches to its host's width, so its
 * lines keep their width (`vector-effect`) and every word, mark and hatch is HTML over it rather
 * than SVG the stretch would distort. A forced palette draws the lines, the hatch and the marks in
 * its inks.
 *
 * What a reader of the page selects it by: the figure is `data-chart="steps"`, with
 * `data-muted` past its reset; its regions are `data-region` — `head` (`StepLineHead`), `plot`,
 * the `scale`'s figure at its top, the `field` the marks stand in, the `drawing` of its lines,
 * the `hover` layer that takes the pointer, and the `axis`, whose two ends are `data-moment`
 * `from` and `to`; its marks are `data-mark` — the `ceiling` at the top's level, `now` the
 * hairline up the plot, the pace's `even`, the readings' `line`, each `reading`'s dot inside its
 * box (`data-reading`, its order), each `place`'s mark inside its box (`data-target`, `restart`,
 * `now` or `reset`), its shape
 * `data-shape` — `ring`, or the forecast's `range` or `point` — and the forecast's `corridor`.
 * Each reading's and place's box is its stop (`data-stop`, its order), the element its hint and
 * the keyboard's focus belong to.
 */
import { computed, nextTick, ref } from 'vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { readingHint } from '@/shared/ui/markHints.ts'
import StepLineHead from '@/shared/ui/StepLineHead.vue'
import { vHintPick, vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import { FRAME_KEYS } from '@/shared/ui/useAxisFrame.ts'
import { useStepAhead } from '@/shared/ui/useStepAhead.ts'
import type { StepTargetPlace } from '@/shared/ui/useStepAhead.ts'
import { useStepAim } from '@/shared/ui/useStepAim.ts'
import { useStepFrame } from '@/shared/ui/useStepFrame.ts'
import { useStepSpan } from '@/shared/ui/useStepSpan.ts'
import { useStepWalk } from '@/shared/ui/useStepWalk.ts'
import {
  evenAt,
  readingsIn,
  STEP_HEIGHT,
  STEP_WIDTH,
  stepAcross,
  stepPath,
  stepTop,
  stepX,
  stepY,
} from '@/shared/ui/windowGeometry.ts'
import type { StepAhead, StepPoint, StepRestart, StepWords } from '@/shared/ui/windowGeometry.ts'

const props = defineProps<{
  /** The moment the last reading holds to: when the answer was read. */
  end: number
  /** The span the window runs over, in ms since the epoch: its start and its reset. */
  from: number
  /** All the line says, in words, for a reader who cannot see it. */
  label: string
  /** The legend's names of the two lines and of the forecast's corridor. */
  legend: { line: string; ahead?: string; even?: string }
  points: readonly StepPoint[]
  to: number
  words: StepWords
  /** What the line draws past its last reading, the window now and its forecast; none past the reset. */
  ahead?: StepAhead | null
  /**
   * Whether the window is past its reset: drawn in the neutral ink, as its bar is, with nothing
   * past its readings.
   */
  ended?: boolean
  /** Whether to draw where steady use would stand: from 0 at `from` to 100 at `to`. */
  even?: boolean
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
/** Where the readings' line ends: at `end`, or at the last reading of a silent window. */
const lineEnd = computed(() => (props.silent ? (props.points.at(-1)?.at ?? props.end) : props.end))
const path = computed(() => stepPath(frame.value, readings.value.held, lineEnd.value))
/** The pace across the span shown: where steady use stands at its start and at its end. */
const evenLine = computed(() => ({
  y1: stepY(frame.value, evenAt(whole.value, shown.value.from)),
  y2: stepY(frame.value, evenAt(whole.value, shown.value.to)),
}))

/**
 * How far down the drawing a mark stands, as a share of its height: the mark stands in its
 * reading's step, at the step's start, and the drawing in the field less its inset.
 */
const markStyle = (point: StepPoint) => ({
  '--step-down': stepY(frame.value, point.value) / STEP_HEIGHT,
})

/** Where the step a reading shown holds ends: at the next reading, or at `end` for the last. */
function stepEnd(index: number) {
  const point = readings.value.inside[index]
  if (!point) return props.end
  const next = props.points[props.points.indexOf(point) + 1]
  return next ? next.at : Math.max(props.end, point.at)
}

/** The corridor past the readings, whether the span shows it and the places past them. */
const {
  clip: corridorClip,
  drawn: corridorShown,
  nowShown,
  targets,
} = useStepAhead(() => props, frame)
/** How far along the plot now stands, from 0 to 1, where the line marks it; null where it does not. */
const nowX = computed(() => (nowShown.value ? stepX(frame.value, props.end) : null))
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
  insetInlineStart: reach.start ?? 'auto',
  insetInlineEnd: reach.start && reach.size ? 'auto' : '0',
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

/**
 * The shape of a place's mark: a ring for «now» and a restart; for the forecast a bar from its
 * high end to its low, or a dash where its two ends are one value.
 */
function markShape({ kind, mark }: StepTargetPlace) {
  if (kind !== 'reset') return 'ring'
  return mark.high === mark.low ? 'point' : 'range'
}

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
/** A place's mark's classes: its kind, a dash where the forecast is one value, and pointed at. */
const placeClass = (target: StepTargetPlace & { stop: number }) => [
  PLACE_MARK[target.kind],
  { 'step-reset-point': markShape(target) === 'point' },
  markClass(target.stop),
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
const { pickAt, placeAt } = useStepAim({ field, hover }, frame, () => walk.aims.value)
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
      :ahead="corridorShown"
      :even="even"
      :muted="ended"
      :now="nowKey"
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
            v-if="even"
            class="step-even"
            data-mark="even"
            x1="0"
            vector-effect="non-scaling-stroke"
            :y1="evenLine.y1"
            :x2="STEP_WIDTH"
            :y2="evenLine.y2"
          />
          <path
            v-if="path"
            class="step-path"
            data-mark="line"
            vector-effect="non-scaling-stroke"
            :d="path"
          />
        </svg>
        <span
          v-if="corridorClip"
          class="step-ahead hatched"
          data-mark="corridor"
          aria-hidden="true"
          :style="{ clipPath: corridorClip }"
        />
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
            :class="markClass(readingStop(index))"
            :data-key="point.key"
            :style="markStyle(point)"
            data-hint-point
        /></span>
        <!-- The restarts among the readings, then «now» and the forecast, each a picture of what -->
        <!-- it says, walked in the order they stand. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <span
          v-for="target in places"
          :key="target.key"
          v-tooltip.detail="target.hint"
          class="step-target"
          role="img"
          :aria-keyshortcuts="FRAME_KEYS"
          :data-target="target.kind"
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
      >
        <span data-moment="from">{{ ends.from }}</span>
        <span data-moment="to">{{ ends.to }}</span>
      </div>
    </div>
  </figure>
</template>

<style scoped src="@/shared/ui/axisFrame.css"></style>

<style scoped src="@/shared/ui/hatch.css"></style>

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
