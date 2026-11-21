<script setup lang="ts">
/**
 * One value's period step by step in its side panel: a column per step of the page's period and
 * step, the value's whole figure in the page's measure, one series in the value's hue on the page,
 * drawn or as its table as every chart of the page is (`ChartSection`). The step not over yet is
 * hatched, a minute after the newest record read has no data yet, and a step with no figure in the
 * measure says so, as the page's own day chart does (`dayColumns`'s rules), and so does a step
 * whose figure says nothing of how much, which is not named (`unnamedEntries`).
 *
 * Each column carries the figure of the step it is compared with in the period before (`before`),
 * read with the value's answers (`useValueRead`), drawn as a short mark at its height; when those
 * steps could not be read there is no mark, and the panel says the read failed beside its actions,
 * the legend keeping the room of the mark's key (`beforeFailed`) so the retry that reads it moves
 * nothing.
 * Its steps narrow nothing: the page is under the panel.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import { useDayWords } from '@/pages/analytics/composables/useDayWords.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { notYet, unfinished } from '@/pages/analytics/utils/dayFigures.ts'
import { figureOf, spentOf, unnamedEntries } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage } from '@/shared/api/analyticsApi.ts'
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type { PeriodChartProps } from '@/shared/ui/chartGeometry.ts'
import PeriodColumns from '@/shared/ui/PeriodColumns.vue'
import PeriodColumnsTable from '@/shared/ui/PeriodColumnsTable.vue'
import type { TextRun } from '@/shared/ui/textRuns.ts'

const props = defineProps<{
  /** The steps of the period before, to mark over each column; null when not read. */
  before: Usage['series'] | null
  /** The value's hue on the page. */
  hue: SeriesSlot
  measure: Measure
  /** The value's name, which its one series says. */
  name: string
  /** When the page's answer was asked for, which says which step is not over yet. */
  readAt: Date
  /** An answer of the value, whose steps are its figures by step. */
  usage: Usage
  /** Whether the read of the period before failed: the legend keeps the room of its mark's key. */
  beforeFailed?: boolean
  /** Whether the period is live, «Now» or «Today»: its chart opens on the step running. */
  live?: boolean
  /** The value's name in runs, where it holds a task's title (`valueRuns`). */
  nameRuns?: readonly TextRun[]
}>()

const { t } = useI18n()
const words = useSpendingWords()
const dayWords = useDayWords()

const step = computed(() => props.usage.period.step)
const title = computed(() =>
  t('analytics.detail.days', { measure: words.measure(props.measure), per: words.per(step.value) }),
)

/** The one series: the value. */
const SERIES = 'value'

const chart = computed<PeriodChartProps>(() => {
  const { usage, measure, readAt } = props
  const said = dayWords(measure, step.value)
  return {
    label: title.value,
    series: [{ key: SERIES, label: props.name, labelRuns: props.nameRuns, slot: props.hue }],
    columns: usage.series.map((point, index) => {
      const figure = figureOf(measure, spentOf(point))
      const was = props.before?.[index]
      const pending = step.value === 'minute' && notYet(point.start, usage.last_event_at)
      const values = figure === null ? {} : { [SERIES]: figure }
      const unnamed = unnamedEntries(measure, values)
      return {
        key: point.start,
        ...words.stepName(point.start, step.value),
        values,
        absent: figure === null ? [SERIES] : [],
        incomplete: unfinished(point.start, step.value, readAt),
        ...(pending ? { pending } : {}),
        ...(unnamed.length ? { unnamed } : {}),
        ...(was ? { before: figureOf(measure, spentOf(was)) } : {}),
      }
    }),
    formatShare: words.markShare,
    formatPart: words.share,
    unread: props.beforeFailed ? ['outline'] : [],
    words: said.words,
    formatValue: said.formatValue,
    valueAxis: said.valueAxis,
  }
})
</script>

<template>
  <ChartSection
    class="value-days"
    :title="title"
  >
    <template #chart>
      <PeriodColumns
        v-bind="chart"
        :live="live"
      />
    </template>
    <template #table>
      <PeriodColumnsTable v-bind="chart" />
    </template>
  </ChartSection>
</template>
