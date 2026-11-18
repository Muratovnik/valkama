<script setup lang="ts">
/**
 * A window's readings over its span: the share spent as steps, flat from one reading to the next
 * and up or down at it, never a slope between them, since a source writes a reading only when a
 * value changed (`windowGeometry`). The last reading holds to `end`, the moment the answer was
 * read. Beside the steps, where steady use from the window's start would stand at each moment
 * (`even`): a thin line from nothing at the start to the whole at the reset. Past `end`, while the
 * window still runs (`ahead`), the corridor of its forecast: from the share it stands at now to
 * where its slower and its faster pace leave it at the reset, a band in the readings' hue under
 * the one hatch of a figure not final yet (`hatch.css`); a forecast of one value is a
 * ribbon of the same hatch, flat along the top from where it runs out. The band keeps half a
 * ribbon's width outside each edge, so its start at now and a range said alike are never a
 * hairline.
 *
 * A running window opens on its start to now and the forecast past it (`aheadSpan`), now at three
 * quarters of the plot, with a switch to the whole window up to its reset; a window past its reset
 * is the whole window alone and draws nothing past its readings. A span that ends before the
 * reset shows the corridor as far as its end, where it runs on. A frame dragged along the plot
 * with a mouse or a pen (`useAxisFrame`), or stretched from the place the keyboard stands on with
 * Shift and an arrow, narrows this line alone to the moments it covers, and the switch takes it
 * back to either span. Nothing else on the page follows it.
 *
 * One axis, of percents from 0, its top written once over the plot: 100, or the highest reading
 * where one ran past it. What the plot draws is told apart by its drawing — the readings a heavier
 * line in the chart's hue, the pace a hairline in the quiet ink, the forecast a hatched band — and
 * a legend names each in the line's head with the switch (`StepLineHead`), the forecast while the
 * span shows it. The two ends of the span shown are named under the plot (`moment`).
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
 * when the reset is and when the window runs out before it; its mark is a ring around the band's
 * end. Where the span ends before the reset, that mark stands at the plot's end, where the band
 * runs on, and its hint says the reset stands past it (`words.past`).
 *
 * One layer over the whole field takes the pointer for every place (`vHintPick`), and nothing else
 * in the plot does: not the drawing, not a place's own box. It runs half a mark past each edge of
 * the field, the reach of a mark (`--step-hit`), so a ring centred on an edge is pointed at whole,
 * and it finds the place under the pointer by its x alone (`aimAt`): a mark within that reach, the
 * nearest of several, wins; elsewhere the place whose stretch holds the pointer — a reading's
 * step, from its moment to the next reading's or to `end`, «now» from `end` to the plot's end
 * where no corridor follows, the forecast along the corridor. So a reader aims at a moment and not
 * at a dot, and a reading a few pixels from the next is still found at its own mark.
 *
 * The readings and the two places are one stop for Tab, walked with the arrows in the order they
 * stand — the readings, then «now», then the forecast — each saying itself in its hint and as its
 * name. Tab lands on the latest reading. Each hint lies over the page at its mark, so pointing
 * moves nothing: a reading's at the top right of its dot (`data-hint-point`, `hintPlacement.ts`),
 * a place's beside its ring, level with the ring's top (`data-hint-mark`), so a forecast that runs
 * out at the top of the plot keeps its hint off the line's head. Every reading is also in the
 * figure's name and in its table twin (`StepLineTable`), and so is the forecast. The drawing
 * stretches to its host's width, so its lines keep their width (`vector-effect`) and every word,
 * mark and hatch is HTML over it rather than SVG the stretch would distort. A forced palette draws
 * the lines, the hatch and the marks in its inks.
 *
 * What a reader of the page selects it by: the figure is `data-chart="steps"`; its regions are
 * `data-region` — `head` (`StepLineHead`), `plot`, the `scale`'s figure at its top, the `field`
 * the marks stand in, the `drawing` of its lines, the `hover` layer that takes the pointer, and
 * the `axis`, whose two ends are `data-moment` `from` and `to`; its marks are `data-mark` — the
 * readings' `line`, each `reading`'s dot inside its box (`data-reading`, its order), each
 * `place`'s ring inside its box (`data-target`, `now` or `reset`) and the forecast's `corridor`.
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
import type {
  StepAhead,
  StepAim,
  StepPoint,
  StepSpan,
  StepWords,
} from '@/shared/ui/windowGeometry.ts'

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
  /** Whether the window has reset since it was read: the whole window is then its one span. */
  ended?: boolean
  /** Whether to draw where steady use would stand: from 0 at `from` to 100 at `to`. */
  even?: boolean
  /** A moment as the axis names an end of the span shown, «14:05». */
  moment: (at: number) => string
}>()

const span = useStepSpan(
  () => props,
  () => props.words,
)
const { shown, whole } = span

const frame = computed(() => ({ ...shown.value, top: stepTop(props.points) }))
const readings = computed(() => readingsIn(shown.value, props.points))
const path = computed(() => stepPath(frame.value, readings.value.held, props.end))
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
const { clip: corridorClip, drawn: corridorShown, targets } = useStepAhead(() => props, frame)
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
/** Where a place's mark stands, as its style: its top and its foot, at its stretch's side. */
/**
 * The class of a place's ring by its kind, written whole: a class composed from a template hides
 * from a search, and from the guard over the tests' selectors, which class the line writes.
 */
const PLACE_MARK = { now: 'step-now-mark', reset: 'step-reset-mark' } as const

const targetMark = ({ mark }: StepTargetPlace) => ({
  '--step-high': mark.high,
  '--step-low': mark.low,
  '--step-side': mark.side,
})

/** How many places the keyboard walks: the readings shown and the places past them. */
const stops = computed(() => readings.value.inside.length + targets.value.length)
/** A place past the readings by its order among them. */
const stopOf = (index: number) => readings.value.inside.length + index

/** The place under the pointer or the keyboard, its mark painted. */
const pointed = ref<number | null>(null)
const markClass = (index: number) => ({ 'step-shown': pointed.value === index })

/** Every place in the order the keyboard walks them, as the pointer finds each. */
const aims = computed<StepAim[]>(() => [
  ...readings.value.inside.map((point, index) => ({
    at: point.at,
    from: point.at,
    to: stepEnd(index),
  })),
  ...targets.value.map(({ aim }) => aim),
])

/** The one place Tab lands on: the last stood on while it is still there, else the latest reading. */
const stood = ref<number | null>(null)
const stop = computed(() => {
  const latest = Math.max(0, readings.value.inside.length - 1)
  return stood.value !== null && stood.value < stops.value ? stood.value : latest
})

const field = ref<HTMLElement | null>(null)
/** The one layer that takes the pointer, half a mark past each edge of the field. */
const hover = ref<HTMLElement | null>(null)
const { pickAt, placeAt } = useStepAim({ field, hover }, frame, () => aims.value)
const { framing, keys } = useStepFrame(field, { coveredBy, frame, narrow: span.narrow })

/** The moments a place covers: a reading its step, «now» its moment, the forecast its corridor. */
function coveredBy(index: number): StepSpan | null {
  const point = readings.value.inside[index]
  return point
    ? { from: point.at, to: stepEnd(index) }
    : (targets.value[index - readings.value.inside.length]?.covers ?? null)
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
  const count = stops.value
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
    :aria-label="label"
    data-hint-frame
  >
    <StepLineHead
      :chosen="span.chosen.value"
      :options="span.options.value"
      :switched="span.switched.value"
      :views="words.views"
      :legend="legend"
      :ahead="corridorShown"
      :even="even"
      @choose="span.choose"
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
            v-if="even"
            class="step-even"
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
          :data-stop="index"
          :tabindex="tabOf(index)"
          :style="stepStyle(index)"
          @focus="stand(index)"
          @blur="pointed = null"
          @keydown="move"
          @keyup="keys.release"
          ><span
            class="step-mark"
            aria-hidden="true"
            data-mark="reading"
            :class="markClass(index)"
            :data-key="point.key"
            :style="markStyle(point)"
            data-hint-point
        /></span>
        <!-- «Now» and the forecast, walked on after the readings, each a picture of what it says. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <span
          v-for="(target, index) in targets"
          :key="target.kind"
          v-tooltip.detail="target.hint"
          class="step-target"
          role="img"
          :aria-keyshortcuts="FRAME_KEYS"
          :data-target="target.kind"
          :data-stop="stopOf(index)"
          :tabindex="tabOf(stopOf(index))"
          :style="reachStyle(target)"
          @focus="stand(stopOf(index))"
          @blur="pointed = null"
          @keydown="move"
          @keyup="keys.release"
          ><span
            class="step-target-mark"
            aria-hidden="true"
            data-mark="place"
            :class="[PLACE_MARK[target.kind], markClass(stopOf(index))]"
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
    </div>
    <div
      class="step-axis"
      aria-hidden="true"
      data-region="axis"
    >
      <span data-moment="from">{{ moment(shown.from) }}</span>
      <span data-moment="to">{{ moment(shown.to) }}</span>
    </div>
  </figure>
</template>

<style scoped src="@/shared/ui/axisFrame.css"></style>

<style scoped src="@/shared/ui/hatch.css"></style>

<style scoped src="@/shared/ui/stepMarks.css"></style>

<style scoped>
.step-line {
  display: grid;
  gap: var(--space-2);
  min-inline-size: 0;
  margin: 0;
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

/* The top's figure stands in a band of its own above the drawing, so a line at the top runs
   under it rather than through it. */
.step-plot {
  position: relative;
  padding-block-start: var(--space-4);
}

.step-top {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  color: var(--color-text-tertiary);
}

/* The plot a frame is dragged along: nothing in it is text a press would select. The drawing
   stands inset in it by half a mark as it is drawn when pointed at, ring and all, so a mark at 0 %
   and one at the top stand whole inside the plot, and in the step that takes the pointer for it:
   drawn to the plot's edge, the mark of a reading at 0 % hung half under the floor, and there the
   pointer found no reading. How near a mark the pointer finds it, half a mark as drawn when
   pointed at; the least width of a place's box, which the keyboard's ring is drawn on; and half
   the width of the forecast's ribbon, are the plot's own. */
.step-field {
  --step-inset: calc(var(--space-2) * 0.75 + var(--space-hair));
  --step-hit: calc(var(--space-2) * 0.75);
  --step-reach: 24px;
  --step-ribbon: calc(var(--space-1) * 0.75);

  position: relative;
  block-size: var(--space-24);
  user-select: none;
}

/* With no reading, the field says so where the line would run, over its floor. */
.step-empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.step-svg {
  position: absolute;
  inset: var(--step-inset) auto auto 0;
  display: block;
  inline-size: 100%;
  block-size: calc(100% - 2 * var(--step-inset));
  overflow: visible;
  pointer-events: none;
}

.step-floor {
  stroke: var(--color-rule-strong);
  stroke-width: 1;

  @media (forced-colors: active) {
    stroke: GrayText;
  }
}

.step-even {
  stroke: var(--color-text-tertiary);
  stroke-width: 1;

  @media (forced-colors: active) {
    stroke: GrayText;
  }
}

.step-path {
  fill: none;
  stroke: var(--color-series-1);
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;

  @media (forced-colors: active) {
    stroke: CanvasText;
  }
}

/* A frame over the moments it covers (`axisFrame.css`), as tall as the plot. */
.step-span {
  position: absolute;
  inset-block: 0;
}

.step-axis {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  color: var(--color-text-tertiary);
}
</style>
