<script setup lang="ts">
/**
 * The period step by step for each of the dimension's largest values, a small chart each on one
 * scale, then one for the rest of its values together; work with no value there and work nobody
 * can place are among the largest where their figures put them, a chart of their own in the
 * neutral hue (`dayMultiples`, `SmallMultiples`). Each chart is in its
 * value's hue on the page (`slots`) and says its name, so the hue never speaks alone. Drawn, or as
 * its table, as every chart of the page is (`ChartSection`).
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { dayMultiples } from '@/pages/analytics/utils/dayMultiples.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension } from '@/shared/api/analyticsApi.ts'
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import type { MultiplesWords, SmallMultiple } from '@/shared/ui/multiplesGeometry.ts'
import SmallMultiples from '@/shared/ui/SmallMultiples.vue'
import SmallMultiplesTable from '@/shared/ui/SmallMultiplesTable.vue'

const props = defineProps<{
  by: UsageDimension
  measure: Measure
  narrow: boolean
  /** The hue of each value on the page, by its key. */
  slots: ReadonlyMap<string, SeriesSlot>
  usage: Usage
}>()

const { t } = useI18n()
const words = useSpendingWords()

const title = computed(() =>
  t('analytics.panel.multiples.title', {
    measure: words.measure(props.measure),
    per: words.per(props.usage.period.step),
    by: t(`analytics.byDimension.${props.by}`),
  }),
)

const multiples = computed<SmallMultiple[]>(() =>
  dayMultiples(props).map(({ line, values }) => ({
    key: line.key,
    label: words.lineLabel(props.by, line),
    // Work with no value is charted as a value is, on the same scale; the folded tail stands apart.
    kind: line.kind === 'other' ? 'other' : 'category',
    slot: line.kind === 'category' ? (props.slots.get(line.key) ?? 'other') : 'other',
    values,
    valueText: words.lineFigure(props.measure, line.spent),
  })),
)

const periods = computed(() =>
  props.usage.series.map((point) => ({
    key: point.start,
    label: words.stepName(point.start, props.usage.period.step).label,
  })),
)

const chartWords = computed<MultiplesWords>(() => ({
  category: words.dimension(props.by),
  empty: t('analytics.bars.empty'),
  scale: t('analytics.panel.multiples.scale'),
  total: t('analytics.panel.multiples.period'),
  // Time is always counted; tokens and a price can be absent from a day that spent.
  absent: props.measure === 'time' ? undefined : t(`analytics.days.absent.${props.measure}`),
}))

const formatValue = (amount: number) => words.scale(props.measure, amount)
const valueAxis = computed(() => words.axis(props.measure))
</script>

<template>
  <ChartSection
    class="spending-multiples"
    :title="title"
    :narrow="narrow"
  >
    <template #chart>
      <SmallMultiples
        :label="title"
        :multiples="multiples"
        :words="chartWords"
        :format-value="formatValue"
        :value-axis="valueAxis"
      />
    </template>
    <template #table>
      <SmallMultiplesTable
        :label="title"
        :multiples="multiples"
        :periods="periods"
        :words="chartWords"
        :format-value="formatValue"
      />
    </template>
  </ChartSection>
</template>
