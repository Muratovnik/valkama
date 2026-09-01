<script setup lang="ts">
/**
 * Where the work stands and how fast it is leaving: the two charts a board reads
 * first, with the KPI strip above them.
 *
 * Flow has two shapes for one fact. The bars are a ledger — every lane at its own
 * width, in board order, readable to the card — and the donut is a proportion. The
 * bars are the default because a column of six labelled numbers answers "how many"
 * and a donut only answers "how much of".
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import VChart from 'vue-echarts'

import AnalyticsChartCard from '@/widgets/analytics-dashboard/components/AnalyticsChartCard.vue'
import AnalyticsMetricLedger from '@/widgets/analytics-dashboard/components/AnalyticsMetricLedger.vue'
import { analyticsFormatters } from '@/widgets/analytics-dashboard/utils/analyticsFormat.ts'
import {
  donutChartOption,
  percent,
  timeSeriesChartOption,
} from '@/widgets/analytics-dashboard/utils/chartOptions.ts'

import { stateColor, statePresentation, toneColor } from '@/shared/lib/uiSystem.ts'
import type { DashboardPayload } from '@/shared/types/analytics.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

const { payload, chartInit } = defineProps<{
  chartInit: { renderer: 'canvas'; useDirtyRect: boolean }
  payload: DashboardPayload
}>()

const emit = defineEmits<{ 'open-table': [key: 'flow' | 'throughput'] }>()
const { t } = useI18n()
const { value } = analyticsFormatters(t)

const flowView = ref<'bars' | 'donut'>('bars')
const throughputView = ref<'bars' | 'line'>('line')

const lineBarsSegments = computed(() => [
  { value: 'line' as const, label: t('dashboard.chartLine') },
  { value: 'bars' as const, label: t('dashboard.chartBars') },
])
const barsDonutSegments = computed(() => [
  { value: 'bars' as const, label: t('dashboard.chartBars') },
  { value: 'donut' as const, label: t('dashboard.chartDonut') },
])

/**
 * One row per state the space declares, named and coloured from the workflow.
 *
 * The name is the state key: a workflow's own word for it, which the catalogue
 * does not have a phrase for and should not invent one. The tone comes from the
 * state's category, so a renamed state keeps its reading and a second active
 * state gets the same one.
 */
const rows = computed(() =>
  payload.states.map((state) => ({
    category: state.category,
    color: stateColor('work-item-state', state.category),
    count: payload.flow[state.key] ?? 0,
    key: state.key,
  })),
)

const flowTotal = computed(
  () => rows.value.reduce((sum, row) => sum + row.count, 0) + payload.flow.unknown,
)
const hasThroughputData = computed(() => payload.throughput.length > 0)

/**
 * Bars can draw an empty space and a donut cannot.
 *
 * A state holding nothing is a bar of zero, which is a reading; the same space
 * as a donut is a ring of nothing, which is the empty state wearing a chart.
 */
const hasFlowData = computed(() => flowView.value === 'bars' || flowTotal.value > 0)

const throughputOption = computed(() =>
  timeSeriesChartOption(
    payload.throughput.map((item) => ({ label: item.date, value: item.count })),
    toneColor('info'),
    throughputView.value,
  ),
)

const flowPieOption = computed(() =>
  donutChartOption(
    [
      ...rows.value.map((row) => ({ name: row.key, value: row.count })),
      ...(payload.flow.unknown
        ? [{ name: t('dashboard.unknown'), value: payload.flow.unknown }]
        : []),
    ],
    rows.value.map((row) => row.color),
  ),
)

/** The bar's width as a share of the whole space, named so the style is a value. */
function barStyle(row: { count: number }) {
  return { width: `${percent(row.count, flowTotal.value)}%` }
}
</script>

<template>
  <AnalyticsMetricLedger
    :kpis="payload.kpis"
    :history-coverage="payload.history_coverage"
  />

  <div class="analytics-grid analytics-grid-primary">
    <AnalyticsChartCard
      class="throughput-card"
      hint-id="throughput-note"
      :title="t('dashboard.throughputSeries')"
      :hint="t('dashboard.throughputHint')"
      :has-data="hasThroughputData"
      :empty-title="t('dashboard.chartEmpty')"
      :empty-description="t('dashboard.chartEmptyDescription')"
      @open-table="emit('open-table', 'throughput')"
    >
      <template #actions>
        <strong class="card-total">{{ value(payload.kpis?.throughput) }}</strong>
        <SegmentedControl
          v-model="throughputView"
          size="compact"
          :options="lineBarsSegments"
          :label="t('dashboard.chartView')"
        />
      </template>
      <VChart
        class="echarts-chart"
        :init-options="chartInit"
        :option="throughputOption"
        :aria-label="t('dashboard.throughputSeries')"
        autoresize
      />
    </AnalyticsChartCard>

    <AnalyticsChartCard
      hint-id="flow-note"
      :title="t('dashboard.flow')"
      :hint="t('dashboard.flowCount', { count: flowTotal })"
      :has-data="hasFlowData"
      :empty-title="t('dashboard.chartEmpty')"
      :empty-description="t('dashboard.chartEmptyDescription')"
      @open-table="emit('open-table', 'flow')"
    >
      <template #actions>
        <SegmentedControl
          v-model="flowView"
          size="compact"
          :options="barsDonutSegments"
          :label="t('dashboard.chartView')"
        />
      </template>
      <ol
        v-if="flowView === 'bars'"
        class="distribution-list"
      >
        <li
          v-for="row in rows"
          :key="row.key"
          class="distribution-row"
        >
          <span class="distribution-label">{{ row.key }}</span
          ><i class="distribution-track"
            ><b
              class="distribution-fill"
              :data-tone="statePresentation('work-item-state', row.category).tone"
              :style="barStyle(row)" /></i
          ><strong class="distribution-value">{{ row.count }}</strong>
        </li>
        <li
          v-if="payload.flow.unknown"
          class="distribution-row"
        >
          <span class="distribution-label">{{ t('dashboard.unknown') }}</span
          ><i class="distribution-track"
            ><b
              class="distribution-fill"
              :style="{ width: `${percent(payload.flow.unknown, flowTotal)}%` }" /></i
          ><strong class="distribution-value">{{ payload.flow.unknown }}</strong>
        </li>
      </ol>
      <VChart
        v-else
        class="echarts-chart"
        :init-options="chartInit"
        :option="flowPieOption"
        :aria-label="t('dashboard.flow')"
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

.analytics-grid-primary {
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.8fr);
}

/* The same height as a chart, so switching shapes does not move the card. */
.distribution-list {
  display: grid;
  gap: var(--space-3);
  align-content: center;
  min-height: 230px;
  padding: var(--space-2) 0;
  margin: 0;
  list-style: none;
}

.distribution-row {
  display: grid;
  grid-template-columns: minmax(110px, 150px) minmax(90px, 1fr) 54px;
  gap: var(--space-3);
  align-items: center;
  font-size: var(--font-size-dense);
}

.distribution-label {
  min-width: 0;
  color: var(--color-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.distribution-track {
  display: flex;
  height: 10px;
  background: var(--color-rule);
  overflow: hidden;
  border-radius: 999px;

  .distribution-fill {
    display: block;
    height: 100%;
    background: var(--color-info);

    &[data-tone='neutral'] {
      background: var(--color-text-muted);
    }

    &[data-tone='success'] {
      background: var(--color-success);
    }

    &[data-tone='warning'] {
      background: var(--color-warning);
    }

    &[data-tone='danger'] {
      background: var(--color-danger);
    }
  }
}

.distribution-value {
  font-variant-numeric: tabular-nums;
  text-align: right;
}

/* The one figure a card prints beside its own title: the total the chart is a
   shape of. It takes the info tone because it is a reading, not a state. */
.card-total {
  color: var(--color-info);
  font-size: var(--font-size-emphasis);
}

@container workspace (width <= 790px) {
  .analytics-grid-primary {
    grid-template-columns: 1fr;
  }
}
</style>
