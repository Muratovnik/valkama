<script setup lang="ts">
/**
 * What the agents did: which tools they called, where they ran, and what it cost.
 *
 * Tokens get a card of their own below the pair because the figure is often absent.
 * A day with a partial record has no total — summing what is present would
 * understate it and look measured — so the empty state here is a full one rather
 * than the compact one the charts above use: "no token data" needs a sentence.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import VChart from 'vue-echarts'

import AnalyticsChartCard from '@/widgets/analytics-dashboard/components/AnalyticsChartCard.vue'
import { analyticsFormatters } from '@/widgets/analytics-dashboard/utils/analyticsFormat.ts'
import {
  CHART_SERIES_PALETTE,
  classifyToolUsage,
  donutChartOption,
  knownTotal,
  runtimeChartOption,
  timeSeriesChartOption,
  toolChartOption,
} from '@/widgets/analytics-dashboard/utils/chartOptions.ts'

import { toneColor } from '@/shared/lib/uiSystem.ts'
import type { DashboardPayload } from '@/shared/types/analytics.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

const { payload, chartInit } = defineProps<{
  chartInit: { renderer: 'canvas'; useDirtyRect: boolean }
  payload: DashboardPayload
}>()

const emit = defineEmits<{ 'open-table': [key: 'runtime' | 'tokens' | 'tools'] }>()
const { t } = useI18n()
const { value, nameLabel, tokenCount } = analyticsFormatters(t)

const tokenView = ref<'bars' | 'line'>('line')
const runtimeView = ref<'bars' | 'donut'>('bars')

const lineBarsSegments = computed(() => [
  { value: 'line' as const, label: t('dashboard.chartLine') },
  { value: 'bars' as const, label: t('dashboard.chartBars') },
])
const barsDonutSegments = computed(() => [
  { value: 'bars' as const, label: t('dashboard.chartBars') },
  { value: 'donut' as const, label: t('dashboard.chartDonut') },
])

const toolRows = computed(() => classifyToolUsage(payload.session_analytics.tool_usage))
const runtimeRows = computed(() => payload.session_analytics.runtime)
const tokenRows = computed(() => payload.usage.token_daily)
const tokenKnownTotal = computed(() =>
  knownTotal(tokenRows.value.map((row) => tokenCount(row.tokens))),
)
const hasTokenData = computed(() => tokenRows.value.some((row) => tokenCount(row.tokens) !== null))
const hasToolData = computed(() => toolRows.value.length > 0)
const hasRuntimeData = computed(() => runtimeRows.value.length > 0)

const toolOption = computed(() =>
  toolChartOption(toolRows.value, {
    success: t('dashboard.successfulCalls'),
    failed: t('dashboard.failedCalls'),
    unclassified: t('dashboard.unclassifiedCalls'),
    other: t('dashboard.otherTools'),
  }),
)
const runtimeOption = computed(() =>
  runtimeChartOption(
    runtimeRows.value.map((row) => ({ name: nameLabel(row.name), sessions: row.sessions })),
  ),
)
const runtimePieOption = computed(() =>
  donutChartOption(
    runtimeRows.value.map((row) => ({
      name: nameLabel(row.name),
      value: row.sessions ?? 0,
    })),
    CHART_SERIES_PALETTE,
  ),
)
/** Which drawing of the runtime split is showing, chosen by the control above it. */
const runtimeChosenOption = computed(() =>
  runtimeView.value === 'bars' ? runtimeOption.value : runtimePieOption.value,
)
const tokenOption = computed(() =>
  timeSeriesChartOption(
    tokenRows.value.map((row) => ({ label: row.date, value: tokenCount(row.tokens) })),
    toneColor('warning'),
    tokenView.value,
  ),
)
</script>

<template>
  <div class="analytics-grid analytics-grid-secondary">
    <AnalyticsChartCard
      hint-id="tool-note"
      :title="t('dashboard.toolUsage')"
      :hint="t('dashboard.sessionAnalytics')"
      :has-data="hasToolData"
      :empty-title="t('dashboard.chartEmpty')"
      :empty-description="t('dashboard.chartEmptyDescription')"
      @open-table="emit('open-table', 'tools')"
    >
      <VChart
        class="echarts-chart"
        :init-options="chartInit"
        :option="toolOption"
        :aria-label="t('dashboard.toolUsage')"
        autoresize
      />
    </AnalyticsChartCard>

    <AnalyticsChartCard
      hint-id="runtime-note"
      :title="t('dashboard.runtimeDistribution')"
      :hint="t('dashboard.sessionAnalytics')"
      :has-data="hasRuntimeData"
      :empty-title="t('dashboard.chartEmpty')"
      :empty-description="t('dashboard.chartEmptyDescription')"
      @open-table="emit('open-table', 'runtime')"
    >
      <template #actions>
        <SegmentedControl
          v-model="runtimeView"
          size="compact"
          :options="barsDonutSegments"
          :label="t('dashboard.chartView')"
        />
      </template>
      <VChart
        class="echarts-chart"
        :init-options="chartInit"
        :option="runtimeChosenOption"
        :aria-label="t('dashboard.runtimeDistribution')"
        autoresize
      />
    </AnalyticsChartCard>
  </div>

  <div class="token-card">
    <AnalyticsChartCard
      hint-id="token-note"
      :title="t('dashboard.tokenTrend')"
      :hint="t('dashboard.usageSource', { count: payload.usage.observed_sessions })"
      :has-data="hasTokenData"
      :empty-compact="false"
      :empty-title="t('dashboard.tokensMissingTitle')"
      :empty-description="t('dashboard.tokensMissingDescription')"
      @open-table="emit('open-table', 'tokens')"
    >
      <template #actions>
        <strong
          v-if="tokenKnownTotal !== null"
          class="card-total"
          >{{ t('dashboard.recordedTokens', { count: value(tokenKnownTotal) }) }}</strong
        >
        <SegmentedControl
          v-model="tokenView"
          size="compact"
          :options="lineBarsSegments"
          :label="t('dashboard.chartView')"
        />
      </template>
      <VChart
        class="echarts-chart"
        :init-options="chartInit"
        :option="tokenOption"
        :aria-label="t('dashboard.tokenTrend')"
        autoresize
      />
    </AnalyticsChartCard>
  </div>
</template>

<style scoped>
.analytics-grid {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}

.analytics-grid-secondary {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.token-card {
  margin-top: var(--space-4);
}

/* The one figure a card prints beside its own title. */
.card-total {
  color: var(--color-info);
  font-size: var(--font-size-emphasis);
}

@container workspace (width <= 790px) {
  .analytics-grid-secondary {
    grid-template-columns: 1fr;
  }
}
</style>
