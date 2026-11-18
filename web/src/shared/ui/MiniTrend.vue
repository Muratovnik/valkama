<script setup lang="ts">
/**
 * A period at a glance: a column per day or hour, as tall as its share of the tallest, on a
 * hairline floor, with no scale and no names. It stands beside a figure that says what it adds up
 * to, and reads as one image whose words (`label`) say what the columns would: the reader is
 * never left with the shape alone.
 *
 * A period with no figure (`null`) draws nothing over the floor, and one still running is hatched
 * in its own hue (`hatch.css`), as in `PeriodColumns`, so a short last column does not read as a
 * drop. With no legend to name the hatch, the words do: they say the last period's figure is
 * still running, and they are the trend's hint as well as its name, so a reader who points at it
 * reads them. The
 * columns are told from the ground by their hue and from each other by a gap of ground; a forced
 * palette draws them in its ink and the floor in its quiet ink.
 *
 * Presentational: nothing in it acts, so it takes no focus and nothing in it moves under the
 * pointer. Its box is the box its host gives it, whatever the figures: new figures change the
 * columns' heights and nothing around them.
 */
import { computed } from 'vue'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

export interface TrendPoint {
  key: string
  /** The period's figure in the trend's own units; null where it has none. */
  value: number | null
  /** Whether the period is still running: what it holds so far. */
  incomplete?: boolean
}

const props = defineProps<{
  /** What the columns say, in words, for a reader who cannot see them. */
  label: string
  points: readonly TrendPoint[]
}>()

const tallest = computed(() => Math.max(0, ...props.points.map((point) => point.value ?? 0)))

/** A column as tall as its share of the tallest; none for a period with nothing to draw. */
function height(point: TrendPoint) {
  return !point.value || tallest.value <= 0
    ? null
    : { blockSize: `${(point.value / tallest.value) * 100}%` }
}
</script>

<template>
  <span
    v-tooltip.detail="label"
    class="mini-trend"
    role="img"
    :aria-label="label"
  >
    <span class="mini-trend-floor" />
    <span
      v-for="point in points"
      :key="point.key"
      class="mini-trend-period"
      :data-key="point.key"
    >
      <span
        v-if="height(point)"
        class="mini-trend-column series-fill"
        data-slot="1"
        :class="{ hatched: point.incomplete }"
        :style="height(point)"
      />
    </span>
  </span>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped src="@/shared/ui/hatch.css"></style>

<style scoped>
/* The columns share the width, a gap of ground between them, over the floor they stand on. */
.mini-trend {
  position: relative;
  display: flex;
  gap: var(--space-hair);
  align-items: flex-end;
  min-inline-size: 0;
  block-size: var(--space-6);
}

/* The baseline of a chart, as `PeriodColumns` draws it; a forced palette keeps it in its quiet
   ink. */
.mini-trend-floor {
  position: absolute;
  inset-block-end: 0;
  inset-inline: 0;
  block-size: var(--space-hair);
  background: var(--color-rule-strong);

  @media (forced-colors: active) {
    background: GrayText;
    forced-color-adjust: none;
  }
}

.mini-trend-period {
  display: flex;
  flex: 1 1 0;
  align-items: flex-end;
  min-inline-size: 0;
  block-size: 100%;
}

.mini-trend-column {
  display: block;
  inline-size: 100%;
  min-block-size: var(--space-hair);
  border-start-start-radius: calc(var(--radius-status) / 2);
  border-start-end-radius: calc(var(--radius-status) / 2);
}
</style>
