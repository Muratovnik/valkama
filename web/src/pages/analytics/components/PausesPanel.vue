<script setup lang="ts">
/**
 * The panel of the pauses before model requests: how much of the prompt cache a request read after
 * a pause of each length, a table per environment — the client, the role, the model and the
 * sign-in — with a line per bucket of pause and a line of their sum (`pauseTables`). A bucket no
 * request fell in keeps its line, empty, so every table has the same lines and the five-minute and
 * one-hour cliffs read at the same height in each.
 *
 * What the pause waited on is chosen in the heading (`waits`), the machine first: a person's waits
 * are the control sample, never warmed, and the wakes are the requests a keep-warm hook started,
 * whose cost is what warming cost. The choice stands until the page is left, as a chart's choice of
 * its table does. A wait no request followed says so in its own words. What a pause, a share and
 * «cold» are, and that the period applies and the filters do not, the heading's «ⓘ» says once.
 *
 * It reads the pauses itself (`usePausesRead`), not the page's usage: when it opens, when the
 * period changes and each time the bar asks a refresh (`refreshes`). Its first wait, a first read
 * that failed, a period with no end and an answer with no request stand in the product's shared
 * state panel. While it is read again the answer on show stays; a read again that failed keeps it, and a
 * line under the heading says so (`data-note="failed-again"`).
 *
 * What a reader of the page selects it by: each environment's block is `data-environment`, its key;
 * each line of a table is `data-bucket`, the answer's key of its bucket, and the sum `data-bucket`
 * `total`.
 */
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import { usePausesRead } from '@/pages/analytics/composables/usePausesRead.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { pauseTables } from '@/pages/analytics/utils/pauseTables.ts'
import type { PauseFigures, PauseTable } from '@/pages/analytics/utils/pauseTables.ts'

import { useUsageWords } from '@/widgets/work-item-inspector/utils/useUsageWords.ts'

import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import { PAUSE_WAITS } from '@/shared/api/analyticsPausesApi.ts'
import type { Pauses, PauseWait } from '@/shared/api/analyticsPausesApi.ts'
import { uiDegraded, uiEmpty, uiError, uiLoading, uiReady } from '@/shared/api/platformUiState.ts'
import type { PlatformUiState } from '@/shared/api/platformUiState.ts'
import ChartTable from '@/shared/ui/ChartTable.vue'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

const props = defineProps<{
  /** How many times the bar asked a refresh: each one reads the pauses again. */
  refreshes: number
  view: AnalyticsView
}>()

const { t, locale } = useI18n()
const words = useSpendingWords()
const usageWords = useUsageWords()

const { read: pausesRead, refresh } = usePausesRead({ view: () => props.view })
watch(
  () => props.refreshes,
  () => void refresh(),
)

const state = computed<PlatformUiState<Pauses>>(() => {
  const read = pausesRead.value
  if (read.status === 'loading') return uiLoading()
  if (read.status === 'failed') return uiError('analytics.pauses.failed')
  if (read.status === 'no-period') return uiEmpty('analytics.pauses.noPeriod')
  const { pauses } = read
  if (!pauses.rows.length) return uiEmpty('analytics.pauses.none')
  return read.refreshing ? uiDegraded(pauses, read.readAt) : uiReady(pauses)
})
const failedAgain = computed(
  () => pausesRead.value.status === 'ready' && pausesRead.value.failedAgain,
)

const wait = ref<PauseWait>('machine')
const waits = computed(() =>
  PAUSE_WAITS.map((value) => ({ value, label: t(`analytics.pauses.waits.${value}`) })),
)
const about = computed(() =>
  (['pause', 'shares', 'cold', 'person', 'wake', 'period', 'cost'] as const).map((caveat) =>
    t(`analytics.pauses.about.${caveat}`),
  ),
)

/** A bucket's words by the answer's key; a key this build does not know stands as it is. */
const BUCKET_WORDS: Readonly<Record<string, string>> = {
  '0-4m': 'm0',
  '4-5m': 'm4',
  '5-6m': 'm5',
  '6-30m': 'm6',
  '30-60m': 'm30',
  '60-70m': 'm60',
  '70m-3h': 'm70',
  '3-12h': 'h3',
  '12h+': 'h12',
}
const bucketName = (key: string) =>
  key in BUCKET_WORDS ? t(`analytics.pauses.buckets.${BUCKET_WORDS[key]}`) : key

const environment = (table: PauseTable) =>
  t('analytics.pauses.environment', {
    client: t(`analytics.pauses.clients.${table.client}`),
    role: t(`analytics.pauses.roles.${table.role}`),
    model: table.model || t('analytics.pauses.noModel'),
    auth: t(`analytics.pauses.auth.${table.auth ?? 'unknown'}`),
  })

const count = (value: number) => new Intl.NumberFormat(locale.value).format(value)
const shareOf = (ratio: number | null) => (ratio === null ? '' : words.share(ratio))

/** A line's cells in the heads' order, the background's only where the client tells it. */
function cells(figures: PauseFigures | null, backgroundKnown: boolean) {
  if (!figures) return Array.from({ length: backgroundKnown ? 6 : 5 }, () => '')
  const shown = [
    count(figures.requests),
    shareOf(figures.readShare),
    shareOf(figures.writeShare),
    count(figures.cold),
  ]
  if (backgroundKnown)
    shown.push(
      t('analytics.pauses.background', {
        count: count(figures.backgroundRequests ?? 0),
        cold: count(figures.backgroundCold ?? 0),
      }),
    )
  shown.push(usageWords.cost(figures.cost))
  return shown
}

const heads = (backgroundKnown: boolean) => [
  t('analytics.pauses.heads.requests'),
  t('analytics.pauses.heads.read'),
  t('analytics.pauses.heads.written'),
  t('analytics.pauses.heads.cold'),
  ...(backgroundKnown ? [t('analytics.pauses.heads.background')] : []),
  t('analytics.pauses.heads.cost'),
]

const tables = (pauses: Pauses) =>
  pauseTables(pauses, wait.value).map((table) => {
    const name = environment(table)
    return {
      key: table.key,
      name,
      label: t('analytics.pauses.table', { environment: name }),
      heads: heads(table.backgroundKnown),
      lines: table.lines.map((line) => ({
        bucket: line.bucket,
        name: bucketName(line.bucket),
        cells: cells(line.figures, table.backgroundKnown),
      })),
      total: cells(table.total, table.backgroundKnown),
    }
  })
</script>

<template>
  <PlatformStatePanel
    :state="state"
    @retry="refresh"
  >
    <template #default="{ payload }">
      <PanelLevel
        class="pauses-panel"
        level="section"
        :title="t('analytics.pauses.title')"
        :about="about"
      >
        <template #actions="{ size }">
          <SegmentedControl
            v-model="wait"
            :size="size"
            :label="t('analytics.pauses.waits.label')"
            :options="waits"
          />
        </template>
        <p
          v-if="failedAgain"
          class="pauses-panel-note"
          data-note="failed-again"
        >
          {{ t('analytics.pauses.failedAgain') }}
        </p>
        <DataEmptyState
          v-if="!tables(payload).length"
          data-note="no-requests"
          :title="t(`analytics.pauses.noneFor.${wait}`)"
          compact
        />
        <PanelLevel
          v-for="table in tables(payload)"
          :key="table.key"
          level="block"
          :title="table.name"
          :data-environment="table.key"
        >
          <ChartTable
            :label="table.label"
            :empty="false"
            :words="{ empty: '' }"
          >
            <thead>
              <tr>
                <th
                  scope="col"
                  class="chart-cell chart-heading"
                >
                  {{ t('analytics.pauses.heads.pause') }}
                </th>
                <th
                  v-for="head in table.heads"
                  :key="head"
                  scope="col"
                  class="chart-cell chart-heading"
                  data-numeric="true"
                >
                  {{ head }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="line in table.lines"
                :key="line.bucket"
                :data-bucket="line.bucket"
              >
                <th
                  scope="row"
                  class="chart-cell chart-name"
                >
                  {{ line.name }}
                </th>
                <td
                  v-for="(cell, index) in line.cells"
                  :key="index"
                  class="chart-cell"
                  data-numeric="true"
                >
                  {{ cell }}
                </td>
              </tr>
              <tr
                class="pauses-panel-total"
                data-bucket="total"
              >
                <th
                  scope="row"
                  class="chart-cell chart-name"
                >
                  {{ t('analytics.pauses.total') }}
                </th>
                <td
                  v-for="(cell, index) in table.total"
                  :key="index"
                  class="chart-cell"
                  data-numeric="true"
                >
                  {{ cell }}
                </td>
              </tr>
            </tbody>
          </ChartTable>
        </PanelLevel>
      </PanelLevel>
    </template>
  </PlatformStatePanel>
</template>

<style scoped src="@/shared/ui/chartTable.css"></style>

<style scoped>
.pauses-panel {
  min-width: 0;
  container-type: inline-size;
}

/* What the section says before its tables, in the text's ink: the answer on show is the one before. */
.pauses-panel-note {
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
}

/* The sum of the lines over it, in the full ink and the heavier weight, as the token kinds' sum. */
.pauses-panel-total > * {
  color: var(--color-text);
  font-weight: 600;
}
</style>
