<script setup lang="ts">
/**
 * The period day by day: a column per day of the chosen measure, stacked by the largest values
 * of the dimension and «other» for the rest; work with no value there and unknown work stack
 * apart, as in the bars, and never inside «other». The day not over yet is hatched and says
 * «so far», so its short column does not read as a fall; a line stands where the known accounts
 * with a figure in the measure shown changed from the last day a known account had one, and that
 * day's hint, name and table row say the change, «Account change: a → b» (`accountChanges`):
 * work whose organization nobody recorded is no account and marks nothing. The marks are the ones
 * read with the answer shown, and a read of the accounts that failed says the marks are not there
 * rather than leaving them out without a word.
 *
 * Each period that has begun is a control, in the chart and in its table, that narrows the view to
 * that period alone and breaks it down by task: a day, an hour of a single day or a minute of the
 * live hour, each going out as `step` with the reader's own period it names (`stepsSpan`). A
 * frame along the chart (`frames`) goes out as `frame` with the span of the periods it covers, the
 * moments they run between or their days, and leaves the breakdown as it is. A
 * value's segment, legend entry and figure in the table do what its row does (`useLineMarks`): a
 * task opens its card, a value the read can filter by goes out as `narrow`. The
 * axis names a day by its weekday, «27 Tue», and the first day it names and the first of each
 * later month by the date with its month, «Oct 27» (`stepName`, `dayTicks`); the table names each
 * in full.
 *
 * A single day stands as its hours and the live hour as its minutes, each named by its clock time;
 * an hour or a minute still to come has nothing to narrow to, and only shows. A minute after the
 * newest record read has no data yet, which it
 * shows and says rather than a zero; that a minute's figures are an estimate is the section's
 * to say, in its «ⓘ» (`useSectionCaveats`). Given the steps of the period
 * before (`before`), each column carries the figure of the step it is compared with, drawn as a
 * short mark at its height on the same scale, named in the legend and said in the period's hint
 * and the table; while those steps are read there is no mark, and when they could not be read a note
 * under the chart says so. A `brief` chart, standing beside the titles of its tasks, names
 * each task by its number alone.
 *
 * Split by a second dimension (`across`), the answer is read by both and the stack is of its
 * pairs, «claude-opus-5-5 · high», each in its hue of the page, the rest folded into «other» as
 * values are; a pair's segment acts as its first value does.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import { useColourPlaces } from '@/pages/analytics/composables/useColourPlaces.ts'
import { useLineMarks } from '@/pages/analytics/composables/useLineActions.ts'
import type { BeforeSteps } from '@/pages/analytics/composables/usePeriodBefore.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import { stepsSpan } from '@/pages/analytics/utils/analyticsPeriod.ts'
import type { OwnPeriod } from '@/pages/analytics/utils/analyticsPeriod.ts'
import { accountChanges, dayColumns, stackLines } from '@/pages/analytics/utils/dayFigures.ts'
import type { StackLine } from '@/pages/analytics/utils/dayFigures.ts'
import { figureOf, spentOf } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension } from '@/shared/api/analyticsApi.ts'
import type { PeriodChartProps } from '@/shared/ui/chartGeometry.ts'
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
  /** The second dimension the section is split by, which `usage` is read by too; null for none. */
  across?: UsageDimension | null
  /** The steps of the period before, to mark over each column; none marked without. */
  before?: BeforeSteps | null
  /** Whether a task in the stack is named by its number alone, for a chart beside its titles. */
  brief?: boolean
  /** Why the last press here did not narrow the view, in words; empty otherwise. */
  notice?: string
}>()
/**
 * A period pressed to narrow the view to it, or the periods a frame covers, as the reader's own
 * period they name and its name in full; or a value pressed.
 */
const emit = defineEmits<{
  frame: [span: OwnPeriod, label: string]
  narrow: [value: string | null, label: string]
  step: [span: OwnPeriod, label: string]
}>()

const { t } = useI18n()
const words = useSpendingWords()

/** How the period is cut: by days, by hours or by minutes. */
const step = computed(() => props.usage.period.step)

const title = computed(() =>
  words.stepChartTitle(props.measure, props.by, step.value, props.across),
)

/** The steps of the period before, when they were read. */
const beforeSteps = computed(() => (Array.isArray(props.before) ? props.before : null))

/** What the step compared with the column at `index` holds; nothing when none is compared. */
function beforeOf(index: number) {
  const step = beforeSteps.value?.[index]
  return step ? { before: figureOf(props.measure, spentOf(step)) } : {}
}

/** A series' name: its value's, or by its task's number alone where the chart is `brief`. */
function seriesName(line: StackLine['line']) {
  if (!line) return t('analytics.days.other')
  const reference = props.brief && props.by === 'work_item' ? line.value?.reference : null
  return reference ?? words.lineLabel(props.by, line)
}

/** The page's colour keys, which the stack's hues are ranked over (`useColourPlaces`). */
const places = useColourPlaces()
const stacked = computed(() =>
  stackLines({ ...props, places: places.rows(props.by, props.across) }),
)
const marks = useLineMarks({
  by: () => props.by,
  lines: () => stacked.value.flatMap((one) => (one.line ? [one.line] : [])),
  narrow: (value, label) => emit('narrow', value, label),
})

const series = computed(() =>
  stacked.value.map((one) => ({
    ...one,
    label: seriesName(one.line),
    ...(one.line ? marks.markOf(one.line) : {}),
  })),
)

/** The steps' names in full, as a press of one says what it narrows to. */
function spanName(first: number, last: number) {
  const [from, to] = [props.usage.series[first], props.usage.series[last]]
  if (!from || !to) return ''
  if (step.value === 'day')
    return first === last
      ? words.fullDay(from.start)
      : `${words.fullDay(from.start)} – ${words.fullDay(to.start)}`
  return t('analytics.drill.clock', {
    from: words.stepName(from.start, step.value).label,
    to: words.stepName(to.end, step.value).label,
  })
}

/**
 * What pressing the period at `index` does, as its name: narrow the view to it. An hour or a
 * minute still to come, as an hour of «Today» after the one running, has nothing yet and only
 * shows.
 */
function actionOf(index: number) {
  const start = props.usage.series[index]?.start
  if (!start) return {}
  if (step.value === 'day')
    return { action: t('analytics.drill.day', { day: spanName(index, index) }) }
  if (Date.parse(start) > props.readAt.getTime()) return {}
  return { action: t('analytics.drill.step', { span: spanName(index, index) }) }
}

const chart = computed<PeriodChartProps>(() => ({
  label: title.value,
  series: series.value,
  columns: dayColumns(props, series.value, props.readAt).map((column, index) => ({
    ...column,
    ...words.stepName(column.key, step.value),
    ...beforeOf(index),
    ...actionOf(index),
  })),
  formatShare: words.markShare,
  marks:
    typeof props.accounts === 'object'
      ? accountChanges(props.accounts, props.measure).map((change) => ({
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
    pending: t('analytics.time.notYet'),
    period: t(`analytics.time.steps.${step.value}.name`),
    total: t('analytics.days.total'),
  },
  formatValue: (amount: number) => words.scale(props.measure, amount),
  valueAxis: words.axis(props.measure),
}))

/** The places of the periods keyed `first` and `last` in the answer's steps. */
const placeOf = (key: string) => props.usage.series.findIndex((point) => point.start === key)

/** A period pressed, in the chart or its table: the view narrowed to it. */
function period(key: string) {
  const at = placeOf(key)
  const span = stepsSpan(props.usage, at, at)
  if (span) emit('step', span, spanName(at, at))
}

/** The periods a frame covers: the page's period set to them. */
function frame(firstKey: string, lastKey: string) {
  const [first, last] = [placeOf(firstKey), placeOf(lastKey)]
  const span = stepsSpan(props.usage, first, last)
  if (span) emit('frame', span, spanName(first, last))
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
        frames
        @period="period"
        @span="frame"
        @series="marks.select"
        @follow="marks.follow"
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
        @period="period"
        @series="marks.select"
        @follow="marks.follow"
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
