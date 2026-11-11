<script setup lang="ts">
/**
 * The period day by day: a column per day of the chosen measure, stacked by the largest values
 * of the dimension and «other» for the rest; work with no value there and unknown work stack
 * apart, as in the bars, and never inside «other». The day not over yet is hatched and says
 * «so far», so its short column does not read as a fall; a numbered line stands where the known
 * accounts that worked changed from the last day a known account worked, with what changed under
 * the chart (`accountChanges`): work whose organization nobody recorded is no account and marks
 * nothing. The marks are the ones read with the answer shown, and a read of the accounts that
 * failed says the marks are not there rather than leaving them out without a word.
 *
 * Each day is a control, in the chart and in its table, that narrows the view to that day alone
 * and breaks it down by task: it goes out as `day`, with the day as a custom period names it.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import { accountChanges, dayColumns, stackLines } from '@/pages/analytics/utils/dayFigures.ts'
import { dayOf } from '@/pages/analytics/utils/readMoments.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension } from '@/shared/api/analyticsApi.ts'
import type { PeriodChartProps, PeriodSelection } from '@/shared/ui/chartGeometry.ts'
import PeriodColumns from '@/shared/ui/PeriodColumns.vue'
import PeriodColumnsTable from '@/shared/ui/PeriodColumnsTable.vue'

const props = defineProps<{
  /** The period by account behind the answer, for the account marks; none until it lands. */
  accounts: AccountsRead
  by: UsageDimension
  measure: Measure
  narrow: boolean
  /** When the answer was asked for, which says which day is not over yet. */
  readAt: Date
  usage: Usage
  /** Why the last press here did not narrow the view, in words; empty otherwise. */
  notice?: string
}>()
/** A day pressed to narrow the view to it: `2030-03-04`, and its name in full. */
const emit = defineEmits<{ day: [day: string, label: string] }>()

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
    action: t('analytics.drill.day', { day: words.fullDay(column.key) }),
  })),
  actionable: 'column',
  marks:
    typeof props.accounts === 'object'
      ? accountChanges(props.accounts).map((change) => ({
          at: change.at,
          label: words.accounts(change.before, change.after),
        }))
      : [],
  words: {
    // Time is always counted; tokens and a price can be absent from a day that spent.
    absent: props.measure === 'time' ? undefined : t(`analytics.days.absent.${props.measure}`),
    empty: t('analytics.days.empty'),
    incomplete: t('analytics.days.soFar'),
    note: t('analytics.days.note'),
    period: t('analytics.days.day'),
    total: t('analytics.days.total'),
  },
  formatValue: (amount: number) => words.scale(props.measure, amount),
}))

function select({ column }: PeriodSelection) {
  emit('day', dayOf(column), words.fullDay(column))
}
</script>

<template>
  <ChartSection
    class="spending-days"
    :title="title"
    :narrow="narrow"
    :notice="notice"
  >
    <template #chart>
      <PeriodColumns
        v-bind="chart"
        @select="select"
      />
      <p
        v-if="accounts === 'failed'"
        class="spending-days-note"
      >
        {{ t('analytics.days.accountsFailed') }}
      </p>
    </template>
    <template #table>
      <PeriodColumnsTable
        v-bind="chart"
        @select="select"
      />
      <p
        v-if="accounts === 'failed'"
        class="spending-days-note"
      >
        {{ t('analytics.days.accountsFailed') }}
      </p>
    </template>
  </ChartSection>
</template>

<style scoped>
.spending-days-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
