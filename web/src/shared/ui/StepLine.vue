<script setup lang="ts">
/**
 * A window's readings over its span: the share spent as steps, flat from one reading to the next
 * and up or down at it, never a slope between them, since a source writes a reading only when a
 * value changed (`windowGeometry`). The last reading holds to `end`, the moment the answer was
 * read. Beside the steps, where steady use from the window's start would stand at each moment
 * (`even`): a thin line from nothing at the start to the whole at the reset.
 *
 * A running window opens on its start to now and the forecast past it (`aheadSpan`), now at three
 * quarters of the plot, with a switch to the whole window up to its reset; a window past its reset
 * is the whole window alone. A frame dragged along the plot with a mouse or a pen
 * (`useAxisFrame`), or stretched from the reading the keyboard stands on with Shift and an arrow,
 * narrows this line alone to the moments it covers, and the switch takes it back to either span.
 * Nothing else on the page follows it.
 *
 * One axis, of percents from 0, its top written once over the plot: 100, or the highest reading
 * where one ran past it. The two lines are told apart by their drawing — the readings a heavier
 * line in the chart's hue with a mark at each reading, the pace a hairline in the quiet ink — and
 * a legend names both, so neither is told by a hue alone, in grayscale too. The two ends of the
 * span shown are named under the plot (`moment`).
 *
 * No line stands over the plot. Each reading is a mark with its own hint (`markHints.ts`): the
 * whole step it holds, from its moment to the next reading, and its mark are what the pointer
 * points at, so a reader aims at a moment and not at a dot, and the readings are one stop for Tab,
 * walked with the arrows, each saying itself in its hint and as its name. The hint lies over the
 * page at the top right of the reading's mark, the point it speaks for (`data-hint-point`,
 * `hintPlacement.ts`), so pointing moves nothing. Every reading is also in the figure's name and in its table twin
 * (`StepLineTable`). The drawing stretches to its host's width, so its lines keep their width
 * (`vector-effect`) and every word and mark is HTML over it rather than SVG text or circles the
 * stretch would distort. A forced palette draws the lines in its inks.
 */
import { computed, nextTick, ref } from 'vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import { FRAME_KEYS, useAxisFrame, useKeyFrame } from '@/shared/ui/useAxisFrame.ts'
import { useStepSpan } from '@/shared/ui/useStepSpan.ts'
import {
  evenAt,
  readingsIn,
  STEP_HEIGHT,
  STEP_WIDTH,
  stepPath,
  stepTop,
  stepX,
  stepY,
} from '@/shared/ui/windowGeometry.ts'
import type { StepPoint, StepSpan, StepWords } from '@/shared/ui/windowGeometry.ts'

const props = defineProps<{
  /** The moment the last reading holds to: when the answer was read. */
  end: number
  /** The span the window runs over, in ms since the epoch: its start and its reset. */
  from: number
  /** All the line says, in words, for a reader who cannot see it. */
  label: string
  /** The legend's names of the two lines. */
  legend: { line: string; even?: string }
  points: readonly StepPoint[]
  to: number
  words: StepWords
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

/** A place across the plot as a share of its box. */
const across = (at: number) => `${(stepX(frame.value, at) / STEP_WIDTH) * 100}%`

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

/** The step a reading holds, from its moment to the next reading's, or to `end` for the last. */
function stepStyle(index: number) {
  const point = readings.value.inside[index]
  if (!point) return {}
  const start = stepX(frame.value, point.at)
  const stop = stepX(frame.value, stepEnd(index))
  return {
    insetInlineStart: across(point.at),
    inlineSize: `${(Math.max(0, stop - start) / STEP_WIDTH) * 100}%`,
  }
}

/** The reading under the pointer or the keyboard, marked larger. */
const pointed = ref<number | null>(null)
const markClass = (index: number) => ({ 'step-shown': pointed.value === index })

/** The one reading Tab lands on: the last stood on while it is still there, else the latest. */
const stood = ref<number | null>(null)
const stop = computed(() => {
  const count = readings.value.inside.length
  return stood.value !== null && stood.value < count ? stood.value : count - 1
})

const field = ref<HTMLElement | null>(null)
const MOVES: Record<string, (at: number, last: number) => number> = {
  ArrowLeft: (at) => Math.max(0, at - 1),
  ArrowRight: (at, last) => Math.min(last, at + 1),
  Home: () => 0,
  End: (_, last) => last,
}

/** The moments a frame from `start` to `end` pixels into the plot covers. */
function spanOf(start: number, end: number): StepSpan {
  const width = field.value?.clientWidth || 1
  const { from, to } = shown.value
  return { from: from + (start / width) * (to - from), to: from + (end / width) * (to - from) }
}

/** The moments the readings from `first` to `last` hold, from the first's to the last's end. */
function readingsSpan(first: number, last: number): StepSpan | null {
  const start = readings.value.inside[first]
  return start ? { from: start.at, to: stepEnd(last) } : null
}

const { drawn } = useAxisFrame(field, (start, end) => span.narrow(spanOf(start, end)))
const keys = useKeyFrame(field, (first, last) => span.narrow(readingsSpan(first, last)))

/** A frame across the plot between `one` and `other` of `width`, as shares of its box. */
const spanStyle = (one: number, other: number, width: number) => ({
  insetInlineStart: `${(Math.min(one, other) / width) * 100}%`,
  inlineSize: `${(Math.abs(other - one) / width) * 100}%`,
})

/** The frame while it is drawn or stretched; none otherwise. */
const framing = computed(() => {
  const pointer = drawn.value
  const width = field.value?.clientWidth || 1
  if (pointer) return spanStyle(pointer.from, pointer.to, width)
  const stretched = keys.stretched.value
  const [first, last] = stretched ? [stretched.anchor, stretched.reached].sort((a, b) => a - b) : []
  const covered = first === undefined || last === undefined ? null : readingsSpan(first, last)
  return covered
    ? spanStyle(stepX(frame.value, covered.from), stepX(frame.value, covered.to), STEP_WIDTH)
    : null
})

/**
 * A key on a reading: the arrows, Home and End walk the readings, and Shift with an arrow
 * stretches the frame from the reading stood on as it walks (`useKeyFrame`).
 */
async function move(event: KeyboardEvent) {
  const count = readings.value.inside.length
  if (!count) return
  const stretched = keys.stretch(event, stop.value, count)
  const to = MOVES[event.key]
  if (stretched === null && !to) return
  event.preventDefault()
  stood.value = stretched ?? to?.(stop.value, count - 1) ?? stop.value
  await nextTick()
  moveFocus(field.value?.querySelector<HTMLElement>(`[data-reading="${stood.value}"]`))
}

/** Only the reading Tab lands on is in the page's order; the arrows reach the rest. */
const tabOf = (index: number) => (index === stop.value ? 0 : -1)

function stand(index: number) {
  stood.value = index
  pointed.value = index
}
</script>

<template>
  <figure
    class="step-line"
    :aria-label="label"
    data-hint-frame
  >
    <div class="step-head">
      <SegmentedControl
        v-if="span.switched.value"
        class="step-views"
        size="compact"
        :label="words.views"
        :model-value="span.chosen.value"
        :options="span.options.value"
        @update:model-value="span.choose"
      />
      <span
        class="step-legend"
        aria-hidden="true"
      >
        <span class="step-key"><span class="step-swatch swatch-line" />{{ legend.line }}</span>
        <span
          v-if="even && legend.even"
          class="step-key"
          ><span class="step-swatch swatch-even" />{{ legend.even }}</span
        >
      </span>
    </div>
    <div class="step-plot">
      <span
        class="step-top"
        aria-hidden="true"
        >{{ words.top }}</span
      >
      <div
        ref="field"
        class="step-field"
      >
        <p
          v-if="!points.length"
          class="step-empty"
        >
          {{ words.empty }}
        </p>
        <svg
          class="step-svg"
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
            vector-effect="non-scaling-stroke"
            :d="path"
          />
        </svg>
        <!-- A reading is a picture of its moment and value, walked with the arrows as one stop. -->
        <!-- Its mark is the point its hint speaks for, and takes the pointer for it. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <span
          v-for="(point, index) in readings.inside"
          :key="point.key"
          v-tooltip.detail="point.text"
          class="step-reach"
          role="img"
          :aria-keyshortcuts="FRAME_KEYS"
          :aria-label="point.text"
          :data-reading="index"
          :tabindex="tabOf(index)"
          :style="stepStyle(index)"
          @pointerenter="pointed = index"
          @pointerleave="pointed = null"
          @focus="stand(index)"
          @blur="pointed = null"
          @keydown="move"
          @keyup="keys.release"
          ><span
            class="step-mark"
            aria-hidden="true"
            :class="markClass(index)"
            :data-key="point.key"
            :style="markStyle(point)"
            data-hint-point
        /></span>
        <span
          v-if="framing"
          class="axis-frame step-span"
          aria-hidden="true"
          :style="framing"
        />
      </div>
    </div>
    <div
      class="step-axis"
      aria-hidden="true"
    >
      <span>{{ moment(shown.from) }}</span>
      <span>{{ moment(shown.to) }}</span>
    </div>
  </figure>
</template>

<style scoped src="@/shared/ui/axisFrame.css"></style>

<style scoped>
.step-line {
  display: grid;
  gap: var(--space-2);
  min-inline-size: 0;
  margin: 0;
}

/* The switch of the span at the line's start and the legend over its end, on one row as tall as
   the switch whether it stands there or not, so the plot never moves when it comes or goes. */
.step-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  align-items: center;
  min-inline-size: 0;
  min-block-size: var(--size-control-height-compact);
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.step-legend {
  display: flex;
  flex: none;
  gap: var(--space-3);
  margin-inline-start: auto;
  white-space: nowrap;
}

.step-key {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
}

/* Each key drawn as its line is: the readings heavier in the hue, the pace a hairline. */
.step-swatch {
  display: inline-block;
  inline-size: var(--space-3);
  border-radius: 999px;

  &.swatch-line {
    block-size: var(--space-half);
    background: var(--color-series-1);
  }

  &.swatch-even {
    block-size: var(--space-hair);
    background: var(--color-text-tertiary);
  }

  @media (forced-colors: active) {
    background: CanvasText;
    forced-color-adjust: none;
  }
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
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

/* The plot a frame is dragged along: nothing in it is text a press would select. The drawing
   stands inset in it by half a mark as it is drawn when pointed at, ring and all, so a mark at 0 %
   and one at the top stand whole inside the plot, and in the step that takes the pointer for it:
   drawn to the plot's edge, the mark of a reading at 0 % hung half under the floor, and there the
   pointer found no reading. */
.step-field {
  --step-inset: calc(var(--space-2) * 0.75 + var(--space-hair));

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
  stroke-linejoin: round;
  stroke-width: 2;

  @media (forced-colors: active) {
    stroke: CanvasText;
  }
}

/* A reading: a mark in the line's hue, ringed in the ground so marks that meet stay apart, at
   the start of its step and as far down as the drawing puts its value (`--step-down`). */
.step-mark {
  --step-down: 0;

  position: absolute;
  inset-block-start: calc(var(--step-inset) + (100% - 2 * var(--step-inset)) * var(--step-down));
  inset-inline-start: 0;
  inline-size: var(--space-2);
  block-size: var(--space-2);
  background: var(--color-series-1);
  border-radius: 50%;
  outline: var(--space-hair) solid var(--color-canvas);
  translate: -50% -50%;

  @media (forced-colors: active) {
    background: CanvasText;
    outline-color: Canvas;
    forced-color-adjust: none;
  }
}

/* The reading under the pointer or the keyboard: a larger mark, the same hue. */
.step-shown {
  scale: 1.5;
}

/* What the pointer points at for a reading: the whole step it holds, the plot's height, at
   least as wide as a pointer can hit. It paints nothing, and the keyboard's ring is drawn on it. */
.step-reach {
  position: absolute;
  inset-block: 0;
  min-inline-size: 24px;
  border-radius: var(--radius-status);
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
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}
</style>
