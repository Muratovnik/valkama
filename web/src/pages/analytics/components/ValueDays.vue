<script setup lang="ts">
/**
 * One value's period step by step in its side panel: a column per step of the page's period and
 * step, the value's whole figure in the page's measure, one series in the value's hue on the page,
 * drawn or as its table as every chart of the page is (`ChartSection`). The step not over yet is
 * hatched, a minute after the newest record read has no data yet, and a step with no figure in the
 * measure says so, as the page's own day chart does (`dayColumns`'s rules).
 *
 * Each column carries the figure of the step it is compared with in the period before, read with
 * the value's filters through the period the page's answer is compared with (`usePeriodBefore`),
 * drawn as a short mark at its height; while those steps are read there is no mark, and when they
 * could not be read a note under the chart says so. Its steps narrow nothing: the page is under
 * the panel.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import { useDayWords } from '@/pages/analytics/composables/useDayWords.ts'
import { usePeriodBefore } from '@/pages/analytics/composables/usePeriodBefore.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { PeriodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'
import { notYet, unfinished } from '@/pages/analytics/utils/dayFigures.ts'
import { figureOf, spentOf } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageFilters } from '@/shared/api/analyticsApi.ts'
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type { PeriodChartProps } from '@/shared/ui/chartGeometry.ts'
import PeriodColumns from '@/shared/ui/PeriodColumns.vue'
import PeriodColumnsTable from '@/shared/ui/PeriodColumnsTable.vue'

const props = defineProps<{
  /** The period the page's answer is compared with; null when it was not read. */
  compared: PeriodBounds | null
  /** The filters the value is read with: the page's and its own. */
  filters: UsageFilters
  /** The value's hue on the page. */
  hue: SeriesSlot
  measure: Measure
  /** The value's name, which its one series says. */
  name: string
  /** Whether the panel is too narrow to read a chart, which makes the table the first view. */
  narrow: boolean
  /** When the page's answer was asked for, which says which step is not over yet. */
  readAt: Date
  /** An answer of the value, whose steps are its figures by step. */
  usage: Usage
  /** Whether the period is live, «Now» or «Today»: its chart opens on the step running. */
  live?: boolean
}>()

const { t } = useI18n()
const words = useSpendingWords()
const dayWords = useDayWords()

const step = computed(() => props.usage.period.step)
const title = computed(() =>
  t('analytics.detail.days', { measure: words.measure(props.measure), per: words.per(step.value) }),
)

const before = usePeriodBefore({
  usage: () => props.usage,
  filters: () => props.filters,
  compared: () => props.compared,
})
const beforeSteps = computed(() => (Array.isArray(before.value) ? before.value : null))

/** The one series: the value. */
const SERIES = 'value'

const chart = computed<PeriodChartProps>(() => {
  const { usage, measure, readAt } = props
  const said = dayWords(measure, step.value)
  return {
    label: title.value,
    series: [{ key: SERIES, label: props.name, slot: props.hue }],
    columns: usage.series.map((point, index) => {
      const figure = figureOf(measure, spentOf(point))
      const was = beforeSteps.value?.[index]
      const pending = step.value === 'minute' && notYet(point.start, usage.last_event_at)
      return {
        key: point.start,
        ...words.stepName(point.start, step.value),
        values: figure === null ? {} : { [SERIES]: figure },
        absent: figure === null ? [SERIES] : [],
        incomplete: unfinished(point.start, step.value, readAt),
        ...(pending ? { pending } : {}),
        ...(was ? { before: figureOf(measure, spentOf(was)) } : {}),
      }
    }),
    formatShare: words.markShare,
    formatPart: words.share,
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
    :narrow="narrow"
  >
    <template #chart>
      <PeriodColumns
        v-bind="chart"
        :live="live"
      />
      <p
        v-if="before === 'failed'"
        class="value-days-note"
      >
        {{ t('analytics.overview.before.failed') }}
      </p>
    </template>
    <template #table>
      <PeriodColumnsTable v-bind="chart" />
    </template>
  </ChartSection>
</template>

<style scoped>
.value-days-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}
</style>
