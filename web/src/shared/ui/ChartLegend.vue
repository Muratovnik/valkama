<script setup lang="ts">
/**
 * Which hue is which series, in words: each series' name beside a swatch of its hue, in the
 * stack's order. A chart of two series or more carries one, so a series is never told apart by
 * its hue alone; one series needs none, since the chart's title already says what it is. A chart
 * that marks a period it is compared with names that mark last (`outline`), beside a short line
 * as the plot draws it at the height that period reached.
 */
import type { PeriodSeries } from '@/shared/ui/chartGeometry.ts'

defineProps<{
  series: readonly PeriodSeries[]
  /** The name of the mark of the period compared with, when the chart draws one. */
  outline?: string
}>()
</script>

<template>
  <ul class="chart-legend">
    <li
      v-for="one in series"
      :key="one.key"
      class="chart-key"
      :data-series="one.key"
    >
      <span
        class="chart-swatch series-fill"
        aria-hidden="true"
        :data-slot="one.slot"
      />
      <span class="chart-key-name">{{ one.label }}</span>
    </li>
    <li
      v-if="outline"
      class="chart-key"
      data-series="outline"
    >
      <span
        class="chart-outline"
        aria-hidden="true"
      />
      <span class="chart-key-name">{{ outline }}</span>
    </li>
  </ul>
</template>

<style scoped src="@/shared/ui/seriesFill.css"></style>

<style scoped>
.chart-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
  padding: 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
  list-style: none;
}

.chart-key {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
}

.chart-key-name {
  overflow-wrap: anywhere;
}

/* The mark of the period compared with, as the plot draws it: a short line, an edge in the
   text's colour that a forced palette inks with the text. */
.chart-outline {
  flex: none;
  inline-size: var(--space-3);
  border-block-start: var(--space-half) solid currentcolor;
  color: var(--color-text-muted);
}

.chart-swatch {
  flex: none;
  inline-size: var(--space-3);
  block-size: var(--space-3);
  border-radius: calc(var(--radius-status) / 2);
}
</style>
