<script setup lang="ts">
/**
 * A window's readings over its span: the share spent as steps, flat from one reading to the next
 * and up or down at it, never a slope between them, since a source writes a reading only when a
 * value changed (`windowGeometry`). The last reading holds to `end`, the moment the answer was
 * read. Beside the steps, where steady use from the window's start would stand at each moment
 * (`even`): a thin line from nothing at the start to the whole at the reset.
 *
 * One axis, of percents from 0, its top written once over the plot: 100, or the highest reading
 * where one ran past it. The two lines are told apart by their drawing — the readings a heavier
 * line in the chart's hue with a mark at each reading, the pace a hairline in the quiet ink — and
 * a legend names both, so neither is told by a hue alone, in grayscale too. The span's two ends
 * are named under the plot.
 *
 * No line stands over the plot. Each reading is a mark with its own hint (`markHints.ts`): the
 * whole step it holds, from its moment to the next reading, is what the pointer points at, so a
 * reader aims at a moment and not at a dot, and the readings are one stop for Tab, walked with the
 * arrows, each saying itself in its hint and as its name. The hint lies over the page, so pointing
 * moves nothing. Every reading is also in the figure's name and in its table twin
 * (`StepLineTable`). The drawing stretches to its host's width, so its lines keep their width
 * (`vector-effect`) and every word and mark is HTML over it rather than SVG text or circles the
 * stretch would distort. A forced palette draws the lines in its inks. The x scale is `stepX`
 * over `STEP_WIDTH`, from `from` to `to`, for what a frame drawn along it needs.
 */
import { computed, nextTick, ref } from 'vue'

import { moveFocus } from '@/shared/lib/moveFocus.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import {
  STEP_HEIGHT,
  STEP_WIDTH,
  stepPath,
  stepTop,
  stepX,
  stepY,
} from '@/shared/ui/windowGeometry.ts'
import type { StepPoint, StepWords } from '@/shared/ui/windowGeometry.ts'

const props = defineProps<{
  /** The moment the last reading holds to: when the answer was read. */
  end: number
  /** The span the plot runs over, in ms since the epoch: the window's start and its reset. */
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
}>()

const frame = computed(() => ({ from: props.from, to: props.to, top: stepTop(props.points) }))
const path = computed(() => stepPath(frame.value, props.points, props.end))
const evenTop = computed(() => stepY(frame.value, 100))

/** A place across the plot as a share of its box. */
const across = (at: number) => `${(stepX(frame.value, at) / STEP_WIDTH) * 100}%`

/** Where a mark stands over the plot, as shares of its box. */
const markStyle = (point: StepPoint) => ({
  insetInlineStart: across(point.at),
  insetBlockStart: `${(stepY(frame.value, point.value) / STEP_HEIGHT) * 100}%`,
})

/** The step a reading holds, from its moment to the next reading's, or to `end` for the last. */
function stepStyle(index: number) {
  const point = props.points[index]
  const next = props.points[index + 1]
  if (!point) return {}
  const start = stepX(frame.value, point.at)
  const stop = stepX(frame.value, next ? next.at : Math.max(props.end, point.at))
  return {
    insetInlineStart: across(point.at),
    inlineSize: `${(Math.max(0, stop - start) / STEP_WIDTH) * 100}%`,
  }
}

/** The reading under the pointer or the keyboard, marked larger. */
const shown = ref<number | null>(null)
const markClass = (index: number) => ({ 'step-shown': shown.value === index })

/** The one reading Tab lands on: the last stood on while it is still there, else the latest. */
const stood = ref<number | null>(null)
const stop = computed(() =>
  stood.value !== null && stood.value < props.points.length ? stood.value : props.points.length - 1,
)

const field = ref<HTMLElement | null>(null)
const MOVES: Record<string, (at: number, last: number) => number> = {
  ArrowLeft: (at) => Math.max(0, at - 1),
  ArrowRight: (at, last) => Math.min(last, at + 1),
  Home: () => 0,
  End: (_, last) => last,
}

async function move(event: KeyboardEvent) {
  const to = MOVES[event.key]
  if (!to || !props.points.length) return
  event.preventDefault()
  stood.value = to(stop.value, props.points.length - 1)
  await nextTick()
  moveFocus(field.value?.querySelector<HTMLElement>(`[data-reading="${stood.value}"]`))
}

/** Only the reading Tab lands on is in the page's order; the arrows reach the rest. */
const tabOf = (index: number) => (index === stop.value ? 0 : -1)

function stand(index: number) {
  stood.value = index
  shown.value = index
}
</script>

<template>
  <figure
    class="step-line"
    :aria-label="label"
  >
    <div
      class="step-head"
      aria-hidden="true"
    >
      <span class="step-legend">
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
            :y1="STEP_HEIGHT"
            :x2="STEP_WIDTH"
            :y2="evenTop"
          />
          <path
            v-if="path"
            class="step-path"
            vector-effect="non-scaling-stroke"
            :d="path"
          />
        </svg>
        <span
          v-for="(point, index) in points"
          :key="point.key"
          class="step-mark"
          aria-hidden="true"
          :class="markClass(index)"
          :data-key="point.key"
          :style="markStyle(point)"
        />
        <!-- A reading is a picture of its moment and value, walked with the arrows as one stop. -->
        <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
        <span
          v-for="(point, index) in points"
          :key="point.key"
          v-tooltip.detail="point.text"
          class="step-reach"
          role="img"
          :aria-label="point.text"
          :data-reading="index"
          :tabindex="tabOf(index)"
          :style="stepStyle(index)"
          @pointerenter="shown = index"
          @pointerleave="shown = null"
          @focus="stand(index)"
          @blur="shown = null"
          @keydown="move"
        />
      </div>
    </div>
    <div
      class="step-axis"
      aria-hidden="true"
    >
      <span>{{ words.start }}</span>
      <span>{{ words.end }}</span>
    </div>
  </figure>
</template>

<style scoped>
.step-line {
  display: grid;
  gap: var(--space-2);
  min-inline-size: 0;
  margin: 0;
}

/* The legend on one line over the plot's end, as tall as a line whatever it says. */
.step-head {
  display: flex;
  gap: var(--space-3);
  justify-content: flex-end;
  align-items: baseline;
  min-inline-size: 0;
  block-size: 1lh;
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.step-legend {
  display: flex;
  flex: none;
  gap: var(--space-3);
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

.step-field {
  position: relative;
  block-size: var(--space-24);
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
  display: block;
  inline-size: 100%;
  block-size: 100%;
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

/* A reading: a mark in the line's hue, ringed in the ground so marks that meet stay apart. */
.step-mark {
  position: absolute;
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

.step-axis {
  display: flex;
  gap: var(--space-3);
  justify-content: space-between;
  color: var(--color-text-tertiary);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}
</style>
