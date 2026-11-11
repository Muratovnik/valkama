<script setup lang="ts">
/**
 * Which hue is which series, in words: each series' name beside a swatch of its hue, in the
 * stack's order. A chart of two series or more carries one, so a series is never told apart by
 * its hue alone; one series needs none, since the chart's title already says what it is. A chart
 * that outlines a period it is compared with names that outline last (`outline`), beside a short
 * dashed edge as the plot draws it.
 */
import type { PeriodSeries } from '@/shared/ui/chartGeometry.ts'

defineProps<{
  series: readonly PeriodSeries[]
  /** The name of the dashed outline the chart draws, when it draws one. */
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

.chart-outline {
  flex: none;
  inline-size: var(--space-3);
  block-size: var(--space-3);
  border: var(--space-hair) dashed currentcolor;
  border-block-end: 0;
  color: var(--color-text-muted);
}

.chart-swatch {
  flex: none;
  inline-size: var(--space-3);
  block-size: var(--space-3);
  border-radius: calc(var(--radius-status) / 2);
}
</style>
