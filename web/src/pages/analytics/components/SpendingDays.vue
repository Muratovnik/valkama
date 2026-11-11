<script setup lang="ts">
/**
 * The period day by day: a column per day of the chosen measure, stacked by the largest values
 * of the dimension and «other» for the rest. The day not over yet is hatched and says «so far»,
 * so its short column does not read as a fall; a numbered line stands where the accounts that
 * worked changed from the day before anyone last worked, with what changed under the chart.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { accountChanges, dayColumns, stackLines } from '@/pages/analytics/utils/dayFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension } from '@/shared/api/analyticsApi.ts'
import type { PeriodChartProps } from '@/shared/ui/chartGeometry.ts'
import PeriodColumns from '@/shared/ui/PeriodColumns.vue'
import PeriodColumnsTable from '@/shared/ui/PeriodColumnsTable.vue'

const props = defineProps<{
  /** The period by account, for the account marks; none are drawn without it. */
  accounts: Usage | null
  by: UsageDimension
  measure: Measure
  narrow: boolean
  /** When the answer was asked for, which says which day is not over yet. */
  readAt: Date
  usage: Usage
}>()

const { t } = useI18n()
const words = useSpendingWords()

const title = computed(() => words.dayChartTitle(props.measure, props.by))

const series = computed(() =>
  stackLines(props).map((one) => ({
    ...one,
    label: one.line ? words.lineLabel(props.by, one.line) : t('analytics.days.other'),
  })),
)

const chart = computed<PeriodChartProps>(() => ({
  label: title.value,
  series: series.value,
  columns: dayColumns(props, series.value, props.readAt).map((column) => ({
    ...column,
    label: words.day(column.key),
    fullLabel: words.fullDay(column.key),
  })),
  marks: props.accounts
    ? accountChanges(props.accounts).map((change) => ({
        at: change.at,
        label: words.accounts(change.before, change.after),
      }))
    : [],
  words: {
    empty: t('analytics.days.empty'),
    incomplete: t('analytics.days.soFar'),
    note: t('analytics.days.note'),
    period: t('analytics.days.day'),
    total: t('analytics.days.total'),
  },
  formatValue: (amount: number) => words.scale(props.measure, amount),
}))
</script>

<template>
  <ChartSection
    class="spending-days"
    :title="title"
    :narrow="narrow"
  >
    <template #chart>
      <PeriodColumns v-bind="chart" />
    </template>
    <template #table>
      <PeriodColumnsTable v-bind="chart" />
    </template>
  </ChartSection>
</template>
