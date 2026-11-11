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
 *
 * A single day stands as its hours, which narrow nothing further. Given the steps of the period
 * before (`before`), each column carries the figure of the step it is compared with, drawn as a
 * dashed outline on the same scale, named in the legend and said in the readout and the table;
 * while those steps are read there is no outline, and when they could not be read a note under
 * the chart says so. A `brief` chart, standing beside the titles of its tasks, names
 * each task by its number alone.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import { useOverviewWords } from '@/pages/analytics/composables/useOverviewWords.ts'
import type { BeforeSteps } from '@/pages/analytics/composables/usePeriodBefore.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import { accountChanges, dayColumns, stackLines } from '@/pages/analytics/utils/dayFigures.ts'
import type { StackLine } from '@/pages/analytics/utils/dayFigures.ts'
import { dayOf } from '@/pages/analytics/utils/readMoments.ts'
import { figureOf, spentOf } from '@/pages/analytics/utils/usageFigures.ts'

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
  /** The steps of the period before, to outline behind each column; none outlined without. */
  before?: BeforeSteps | null
  /** Whether a task in the stack is named by its number alone, for a chart beside its titles. */
  brief?: boolean
  /** Why the last press here did not narrow the view, in words; empty otherwise. */
  notice?: string
}>()
/** A day pressed to narrow the view to it: `2030-03-04`, and its name in full. */
const emit = defineEmits<{ day: [day: string, label: string] }>()

const { t } = useI18n()
const words = useSpendingWords()
const overviewWords = useOverviewWords()

/** A single day, read by the hour. */
const hourly = computed(() => props.usage.period.step === 'hour')

const title = computed(() =>
  hourly.value
    ? overviewWords.hourChartTitle(props.measure, props.by)
    : words.dayChartTitle(props.measure, props.by),
)

/** The steps of the period before, when they were read. */
const beforeSteps = computed(() => (Array.isArray(props.before) ? props.before : null))

/** What the step compared with the column at `index` holds; nothing when none is compared. */
function beforeOf(index: number) {
  const step = beforeSteps.value?.[index]
  return step ? { before: figureOf(props.measure, spentOf(step)) } : {}
}

/** A column's name, short and in full: a day, or an hour of a single day. */
const nameOf = (key: string) =>
  hourly.value
    ? { label: overviewWords.hour(key), fullLabel: overviewWords.fullHour(key) }
    : { label: words.day(key), fullLabel: words.fullDay(key) }

/** A series' name: its value's, or by its task's number alone where the chart is `brief`. */
function seriesName(line: StackLine['line']) {
  if (!line) return t('analytics.days.other')
  const reference = props.brief && props.by === 'work_item' ? line.value?.reference : null
  return reference ?? words.lineLabel(props.by, line)
}

const series = computed(() =>
  stackLines(props).map((one) => ({ ...one, label: seriesName(one.line) })),
)

const chart = computed<PeriodChartProps>(() => ({
  label: title.value,
  series: series.value,
  columns: dayColumns(props, series.value, props.readAt).map((column, index) => ({
    ...column,
    ...nameOf(column.key),
    ...beforeOf(index),
    ...(hourly.value
      ? {}
      : { action: t('analytics.drill.day', { day: words.fullDay(column.key) }) }),
  })),
  // An hour narrows to the day it is already of, so only a day acts.
  actionable: hourly.value ? null : 'column',
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
    before: t('analytics.overview.before.word'),
    empty: t('analytics.days.empty'),
    incomplete: t('analytics.days.soFar'),
    note: t('analytics.days.note'),
    period: t('analytics.days.day'),
    total: t('analytics.days.total'),
  },
  formatValue: (amount: number) => words.scale(props.measure, amount),
  valueAxis: words.axis(props.measure),
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
        v-if="before === 'failed'"
        class="spending-days-note"
      >
        {{ t('analytics.overview.before.failed') }}
      </p>
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
