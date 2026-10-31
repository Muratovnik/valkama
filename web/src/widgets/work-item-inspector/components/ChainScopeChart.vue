<script setup lang="ts">
/**
 * How a chain's scope moved: everything it has ever held, and how much of that
 * is closed. The distance between the two lines is the open work, shaded so the
 * question the owner asks — is this converging — is answered by its shape before
 * any number is read.
 *
 * One axis and two cumulative series on it. The drawing stretches to the card's
 * width, so the strokes do not scale with it and every label is HTML beside the
 * drawing rather than SVG text the stretch would distort. The numbers are in the
 * accessible name and in the readout, never only in a line's colour.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { seriesDate } from '@/widgets/work-item-inspector/utils/chainSummary.ts'

import type { ChainDay } from '@/shared/api/planningChainApi.ts'

const props = defineProps<{ series: readonly ChainDay[] }>()

const { t, locale } = useI18n()

const WIDTH = 300
const HEIGHT = 96

const ceiling = computed(() => Math.max(1, ...props.series.map((day) => day.total)))

/**
 * Time runs along the x axis by calendar day. The series lists only the days
 * something changed, so spacing points evenly would squeeze a quiet month into
 * one step; and because the totals are cumulative, each value holds until the
 * next change, which is why the lines are drawn as steps.
 */
const DAY_MS = 86_400_000
const offsets = computed(() => {
  const first = props.series[0] ? seriesDate(props.series[0].day).valueOf() : 0
  return props.series.map((day) => (seriesDate(day.day).valueOf() - first) / DAY_MS)
})
const span = computed(() => Math.max(1, offsets.value.at(-1) ?? 0))

function x(index: number): number {
  return (offsets.value[index] / span.value) * WIDTH
}

function y(value: number): number {
  return HEIGHT - (value / ceiling.value) * HEIGHT
}

function line(read: (day: ChainDay) => number): string {
  return props.series
    .map((day, index) => {
      const level = y(read(day)).toFixed(2)
      const at = x(index).toFixed(2)
      if (index === 0) return `M${at},${level}`
      return `H${at} V${level}`
    })
    .join(' ')
}

const totalPath = computed(() => line((day) => day.total))
const closedPath = computed(() => line((day) => day.closed_total))

/**
 * The open gap: forward along the scope steps, down to the closed line at the
 * last day, then back along the closed steps undone in reverse.
 */
const gapPath = computed(() => {
  const closed = props.series.map((day) => y(day.closed_total).toFixed(2))
  const last = props.series.length - 1
  const back: string[] = []
  for (let index = last; index > 0; index -= 1)
    back.push(`V${closed[index - 1]}`, `H${x(index - 1).toFixed(2)}`)
  return `${totalPath.value} V${closed[last]} ${back.join(' ')} Z`
})

const format = computed(
  () => new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short', timeZone: 'UTC' }),
)
function dayLabel(day: string): string {
  return format.value.format(seriesDate(day))
}

const hovered = ref<number | null>(null)
const shown = computed(() => hovered.value ?? props.series.length - 1)
const point = computed(() => props.series[shown.value])
const crosshair = computed(() => `${(x(shown.value) / WIDTH) * 100}%`)

function readout(day: ChainDay) {
  return {
    day: dayLabel(day.day),
    total: day.total,
    closed: day.closed_total,
    open: day.total - day.closed_total,
  }
}

const summary = computed(() => {
  const first = props.series[0]
  const last = props.series.at(-1)
  if (!first || !last) return ''
  return t('workItem.chain.chartSummary', {
    from: dayLabel(first.day),
    to: dayLabel(last.day),
    start: first.total,
    ...readout(last),
  })
})

function track(event: PointerEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  if (box.width === 0 || props.series.length < 2) return
  const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
  const target = ratio * span.value
  // The value on a day is the last change on or before it.
  const after = offsets.value.findIndex((offset) => offset > target)
  hovered.value = after === -1 ? offsets.value.length - 1 : Math.max(0, after - 1)
}
</script>

<template>
  <figure
    class="chain-chart"
    role="img"
    :aria-label="summary"
  >
    <div
      class="chain-legend"
      aria-hidden="true"
    >
      <span class="chain-key"
        ><span class="chain-swatch swatch-total" />{{
          t('workItem.chain.seriesTotal', { count: point.total })
        }}</span
      >
      <span class="chain-key"
        ><span class="chain-swatch swatch-closed" />{{
          t('workItem.chain.seriesClosed', { count: point.closed_total })
        }}</span
      >
      <span class="chain-key"
        ><span class="chain-swatch swatch-open" />{{
          t('workItem.chain.seriesOpen', { count: point.total - point.closed_total })
        }}</span
      >
      <span class="chain-day">{{ dayLabel(point.day) }}</span>
    </div>
    <!-- Pointer-only enhancement: the readout above follows the pointer; the
         same numbers are in the figure's accessible name and the summary line. -->
    <!-- eslint-disable-next-line vuejs-accessibility/no-static-element-interactions -->
    <div
      class="chain-plot"
      aria-hidden="true"
      @pointermove="track"
      @pointerleave="hovered = null"
    >
      <span class="chain-ceiling">{{ ceiling }}</span>
      <svg
        class="chain-svg"
        preserveAspectRatio="none"
        focusable="false"
        :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      >
        <line
          class="chain-baseline"
          x1="0"
          vector-effect="non-scaling-stroke"
          :y1="HEIGHT"
          :x2="WIDTH"
          :y2="HEIGHT"
        />
        <path
          class="chain-gap"
          :d="gapPath"
        />
        <path
          class="chain-line line-total"
          vector-effect="non-scaling-stroke"
          :d="totalPath"
        />
        <path
          class="chain-line line-closed"
          vector-effect="non-scaling-stroke"
          :d="closedPath"
        />
      </svg>
      <span
        v-if="hovered !== null"
        class="chain-crosshair"
        :style="{ insetInlineStart: crosshair }"
      />
    </div>
    <div
      class="chain-axis"
      aria-hidden="true"
    >
      <span>{{ dayLabel(series[0].day) }}</span>
      <span>{{ dayLabel(series[series.length - 1].day) }}</span>
    </div>
  </figure>
</template>

<style scoped>
.chain-chart {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
}

.chain-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  align-items: center;
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.chain-key {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
}

.chain-day {
  margin-inline-start: auto;
  color: var(--color-text-tertiary);
}

.chain-swatch {
  width: 14px;
  height: 3px;
  border-radius: var(--radius-status);

  &.swatch-total {
    background: var(--color-text);
  }

  &.swatch-closed {
    background: var(--color-graph-line);
  }

  &.swatch-open {
    height: 10px;
    background: color-mix(in srgb, var(--color-text) 16%, transparent);
  }
}

.chain-plot {
  position: relative;
  height: 96px;
  padding-top: var(--space-1);
}

.chain-ceiling {
  position: absolute;
  inset-block-start: 0;
  inset-inline-start: 0;
  color: var(--color-text-tertiary);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.chain-svg {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.chain-baseline {
  stroke: var(--color-rule-strong);
  stroke-width: 1;
}

.chain-gap {
  fill: color-mix(in srgb, var(--color-text) 16%, transparent);
}

.chain-line {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2;

  &.line-total {
    stroke: var(--color-text);
  }

  &.line-closed {
    stroke: var(--color-graph-line);
  }
}

.chain-crosshair {
  position: absolute;
  inset-block: 0;
  width: 1px;
  background: var(--color-rule-strong);
  pointer-events: none;
}

.chain-axis {
  display: flex;
  justify-content: space-between;
  color: var(--color-text-tertiary);
  font: var(--font-count);
}
</style>
