<script setup lang="ts">
/**
 * Four numbers that say where the board stands, in one strip.
 *
 * One figure size for every KPI. Which one leads is said by the order and the column
 * width; a second, larger size only added a third type size to a strip that is
 * already four numbers wide. Each figure carries the count it was derived from
 * underneath, because a cycle time over three observations is a different claim from
 * one over three hundred.
 */
import { useI18n } from 'vue-i18n'

import { analyticsFormatters } from '@/widgets/analytics-dashboard/utils/analyticsFormat.ts'

import type { DashboardPayload } from '@/shared/types/analytics.ts'

const { kpis } = defineProps<{
  historyCoverage: DashboardPayload['history_coverage']
  kpis: DashboardPayload['kpis'] | undefined
}>()

const { t } = useI18n()
const { value, duration } = analyticsFormatters(t)
</script>

<template>
  <dl
    class="metric-ledger"
    :aria-label="t('dashboard.kpis')"
  >
    <div class="metric-cell metric-primary">
      <dt class="metric-label">{{ t('dashboard.inventory') }}</dt>
      <dd class="metric-figure">{{ value(kpis?.inventory) }}</dd>
      <small class="metric-basis">{{
        t('dashboard.historyScope', {
          work_items: historyCoverage.work_items,
          intervals: historyCoverage.intervals,
        })
      }}</small>
    </div>
    <div class="metric-cell">
      <dt class="metric-label">{{ t('dashboard.completed') }}</dt>
      <dd class="metric-figure">{{ value(kpis?.completed) }}</dd>
      <small class="metric-basis"
        >{{ t('dashboard.throughput') }}: {{ value(kpis?.throughput) }}</small
      >
    </div>
    <div class="metric-cell">
      <dt class="metric-label">{{ t('dashboard.cycle') }}</dt>
      <dd class="metric-figure">{{ duration(kpis?.cycle_seconds) }}</dd>
      <small class="metric-basis">{{
        t('dashboard.observed', { count: kpis?.cycle_observed ?? 0 })
      }}</small>
    </div>
    <div class="metric-cell">
      <dt class="metric-label">{{ t('dashboard.blocked') }}</dt>
      <dd class="metric-figure">{{ value(kpis?.blocked) }}</dd>
      <small class="metric-basis">{{ t('dashboard.reopened') }}: {{ value(kpis?.reopened) }}</small>
    </div>
  </dl>
</template>

<style scoped>
.metric-ledger {
  display: grid;
  grid-template-columns: minmax(230px, 1.25fr) repeat(3, minmax(160px, 0.75fr));
  margin: 0 0 var(--space-4);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

.metric-cell {
  min-width: 0;
  padding: var(--space-4);

  & + .metric-cell {
    border-inline-start: 1px solid var(--color-rule);
  }
}

.metric-label {
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

.metric-figure {
  margin: var(--space-2) 0;
  font: 600 var(--font-size-figure)/var(--line-height-flat) var(--font-family-interface);
  font-variant-numeric: tabular-nums;
}

.metric-basis {
  display: block;
  color: var(--color-text-muted);
  font: var(--font-note);
}

@container workspace (width <= 790px) {
  .metric-ledger {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
