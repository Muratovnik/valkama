<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

import AnalyticsAgentSection from '@/widgets/analytics-dashboard/components/AnalyticsAgentSection.vue'
import AnalyticsCardTable from '@/widgets/analytics-dashboard/components/AnalyticsCardTable.vue'
import AnalyticsExecutionSection from '@/widgets/analytics-dashboard/components/AnalyticsExecutionSection.vue'
import AnalyticsFilterBar from '@/widgets/analytics-dashboard/components/AnalyticsFilterBar.vue'
import AnalyticsFlowSection from '@/widgets/analytics-dashboard/components/AnalyticsFlowSection.vue'
import AnalyticsTableInspector from '@/widgets/analytics-dashboard/components/AnalyticsTableInspector.vue'
import { useAnalyticsTable } from '@/widgets/analytics-dashboard/composables/useAnalyticsTable.ts'
import { hasMaterialDataQualityWarning } from '@/widgets/analytics-dashboard/utils/chartOptions.ts'

import { dashboardExportHref } from '@/entities/analytics/api/analyticsApi.ts'

import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import type { DashboardFilters, DashboardPayload } from '@/shared/types/analytics.ts'
import InfoTip from '@/shared/ui/InfoTip.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    payload: DashboardPayload | null
    state: PlatformUiState<true>
    retryable?: boolean
  }>(),
  { retryable: false },
)

const emit = defineEmits<{
  'filters': [filters: DashboardFilters]
  'open-work-item': [reference: string]
  'retry': []
}>()

use([
  BarChart,
  LineChart,
  PieChart,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
])

const { t, d } = useI18n()

const chartInit = { renderer: 'canvas' as const, useDirtyRect: true }

const { table, openTable, closeTable } = useAnalyticsTable(() => props.payload)
/** Absent means idle; `aria-busy="false"` would make an unnecessary claim. */
const refreshBusyMark = computed(
  () => (props.state.status === 'degraded' && props.state.reason === undefined) || undefined,
)

const hasDataQualityLimits = computed(() => {
  const reading = props.payload
  return reading
    ? hasMaterialDataQualityWarning(reading.history_coverage, reading.evidence_coverage)
    : false
})

function asOf(input: string): string {
  const parsed = new Date(input)
  return Number.isNaN(parsed.valueOf()) ? input : d(parsed, 'activity')
}
</script>

<template>
  <section
    v-if="open"
    id="analytics-results"
    class="analytics-dashboard"
  >
    <PlatformStatePanel
      :state="state"
      :retryable="retryable"
      @retry="emit('retry')"
    >
      <template #default>
        <template v-if="payload">
          <div
            id="analytics-tooltip-root"
            class="analytics-tooltip-root"
            :aria-busy="refreshBusyMark"
          >
            <!-- The context bar names the module; what the page owes the reader
             here is how current the data is and where it is thin. -->
            <header class="dashboard-head">
              <div class="analytics-context">
                <time :datetime="payload.as_of">{{
                  t('dashboard.asOf', { at: asOf(payload.as_of) })
                }}</time>
                <InfoTip
                  v-if="hasDataQualityLimits"
                  :label="t('dashboard.dataQualityLimited')"
                >
                  {{
                    t('dashboard.dataQualityTip', {
                      history: t(`dashboard.coverage.${payload.history_coverage.overall}`),
                      linked: payload.evidence_coverage.states.linked,
                      other: payload.evidence_coverage.states.other_space,
                      unlinked: payload.evidence_coverage.states.unlinked,
                    })
                  }}
                </InfoTip>
              </div>
            </header>

            <div
              v-if="state.status === 'degraded' && state.reason && retryable"
              class="dashboard-recovery"
            >
              <VButton @click="emit('retry')">{{ t('dashboard.retry') }}</VButton>
            </div>

            <AnalyticsFilterBar
              :facets="payload.facets"
              :applied="payload.filters"
              @apply="(filters) => emit('filters', filters)"
            />

            <section
              class="analytics-section"
              aria-labelledby="analytics-attempt-title"
            >
              <header class="section-heading">
                <div>
                  <h2
                    id="analytics-attempt-title"
                    class="section-title"
                  >
                    {{ t('dashboard.attemptSection') }}
                  </h2>
                  <p class="section-hint">{{ t('dashboard.attemptSectionHint') }}</p>
                </div>
              </header>
              <AnalyticsExecutionSection
                :executions="payload.executions"
                @open-table="openTable"
              />
              <p class="section-export">
                <!-- Straight to the endpoint: the file is the server's normalized
                 result, so building a second copy of it here would be a second
                 answer to the same question. -->
                <a
                  class="export-link"
                  :href="dashboardExportHref(payload, 'csv')"
                  download
                  >{{ t('dashboard.exportCsv') }}</a
                >
                <a
                  class="export-link"
                  :href="dashboardExportHref(payload, 'json')"
                  download
                  >{{ t('dashboard.exportJson') }}</a
                >
              </p>
            </section>

            <section
              class="analytics-section"
              aria-labelledby="analytics-flow-title"
            >
              <header class="section-heading">
                <div>
                  <h2
                    id="analytics-flow-title"
                    class="section-title"
                  >
                    {{ t('dashboard.flowSection') }}
                  </h2>
                  <p class="section-hint">{{ t('dashboard.flowSectionHint') }}</p>
                </div>
              </header>
              <AnalyticsFlowSection
                :payload="payload"
                :chart-init="chartInit"
                @open-table="openTable"
              />
            </section>

            <section
              class="analytics-section"
              aria-labelledby="analytics-agent-title"
            >
              <header class="section-heading">
                <div>
                  <h2
                    id="analytics-agent-title"
                    class="section-title"
                  >
                    {{ t('dashboard.agentSection') }}
                  </h2>
                  <p class="section-hint">{{ t('dashboard.agentSectionHint') }}</p>
                </div>
              </header>
              <AnalyticsAgentSection
                :payload="payload"
                :chart-init="chartInit"
                @open-table="openTable"
              />
            </section>

            <section
              class="analytics-section"
              aria-labelledby="analytics-card-title"
            >
              <header class="section-heading">
                <div>
                  <h2
                    id="analytics-card-title"
                    class="section-title"
                  >
                    {{ t('dashboard.cardSection') }}
                  </h2>
                  <p class="section-hint">{{ t('dashboard.cardSectionHint') }}</p>
                </div>
              </header>
              <AnalyticsCardTable
                :rows="payload.longest_open"
                @open-work-item="(reference) => emit('open-work-item', reference)"
              />
            </section>
          </div>
          <AnalyticsTableInspector
            v-if="table"
            :open="true"
            :title="table.title"
            :caption="table.caption"
            :columns="table.columns"
            :rows="table.rows"
            :close-label="t('drawer.close')"
            @close="closeTable"
          />
        </template>
      </template>
    </PlatformStatePanel>
  </section>
</template>

<style scoped>
/* The panels inside measure against this, not the window: a navigation rail
   that collapses and a drawer that opens hand the same viewport several
   different widths. */
.analytics-dashboard {
  min-width: 0;
  color: var(--color-text);
  container: filters / inline-size;
}

.analytics-tooltip-root {
  position: relative;
}

.dashboard-head {
  display: flex;
  gap: var(--space-6);
  justify-content: flex-end;
  align-items: center;
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--color-rule);
}

.analytics-context {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
  align-items: center;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.dashboard-recovery {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--space-3);
}

/* One rule between sections, and only between them: three headings on one screen
   need a boundary the air alone does not give. */
.section-export {
  display: flex;
  gap: var(--space-4);
  margin: 0;
}

.export-link {
  color: var(--color-text-muted);
  font: var(--font-detail);

  &:is(:hover, :focus-visible) {
    color: var(--color-text);
  }
}

.analytics-section {
  min-width: 0;
  margin-top: var(--space-7);

  & + .analytics-section {
    padding-top: var(--space-7);
    margin-top: var(--space-9);
    border-top: 1px solid var(--color-rule);
  }
}

.section-heading {
  display: flex;
  gap: var(--space-4);
  justify-content: space-between;
  margin-bottom: var(--space-4);
}

.section-title {
  margin: 0;
  font: 600 var(--font-size-section)/var(--line-height-snug) var(--font-family-interface);
}

.section-hint {
  max-width: 70ch;
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

@container workspace (width <= 636px) {
  .dashboard-head {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
