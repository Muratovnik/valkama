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
 * The readout over the plot says the reading under the pointer, or the latest when the pointer is
 * elsewhere, on one line that keeps its height, so pointing moves nothing on the page. Every
 * reading is in the figure's accessible name and in its table twin (`StepLineTable`); the plot
 * itself is hidden from a screen reader. The drawing stretches to its host's width, so its lines
 * keep their width (`vector-effect`) and every word and mark is HTML over it rather than SVG
 * text or circles the stretch would distort. A forced palette draws the lines in its inks.
 */
import { computed, ref } from 'vue'

import {
  readingAt,
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

/** Where a mark stands over the plot, as shares of its box. */
const markStyle = (point: StepPoint) => ({
  insetInlineStart: `${(stepX(frame.value, point.at) / STEP_WIDTH) * 100}%`,
  insetBlockStart: `${(stepY(frame.value, point.value) / STEP_HEIGHT) * 100}%`,
})

const hovered = ref<number | null>(null)
/** The reading under the pointer is marked larger, as the readout above says it. */
const markClass = (index: number) => ({ 'step-shown': hovered.value === index })
const shown = computed(() =>
  props.points.length ? (hovered.value ?? props.points.length - 1) : null,
)
const readout = computed(() =>
  shown.value === null ? props.words.empty : (props.points[shown.value]?.text ?? ''),
)

function track(event: PointerEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (box.width === 0 || !props.points.length) return
  hovered.value = readingAt(frame.value, props.points, (event.clientX - box.left) / box.width)
}
</script>

<template>
  <figure
    class="step-line"
    role="img"
    :aria-label="label"
  >
    <div
      class="step-head"
      aria-hidden="true"
    >
      <span class="step-readout one-line">{{ readout }}</span>
      <span class="step-legend">
        <span class="step-key"><span class="step-swatch swatch-line" />{{ legend.line }}</span>
        <span
          v-if="even && legend.even"
          class="step-key"
          ><span class="step-swatch swatch-even" />{{ legend.even }}</span
        >
      </span>
    </div>
    <!-- Pointer-only: the readout above follows the pointer; the same readings are in the
         figure's name and in the table twin. -->
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
    <div
      class="step-plot"
      aria-hidden="true"
      @pointermove="track"
      @pointerleave="hovered = null"
    >
      <span class="step-top">{{ words.top }}</span>
      <div class="step-field">
        <svg
          class="step-svg"
          preserveAspectRatio="none"
          focusable="false"
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
          :class="markClass(index)"
          :data-key="point.key"
          :style="markStyle(point)"
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

/* One line whatever it says: the readout gives way and is cut, the legend keeps its words. */
.step-head {
  display: flex;
  gap: var(--space-3);
  align-items: baseline;
  min-inline-size: 0;
  block-size: 1lh;
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.step-readout {
  flex: 1 1 auto;
  min-inline-size: 0;
  color: var(--color-text);
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

/* The reading the readout says, under the pointer: a larger mark, the same hue. */
.step-shown {
  scale: 1.5;
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
