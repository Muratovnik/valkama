<script setup lang="ts">
/**
 * The period step by step for each of the dimension's largest values, a small chart each on one
 * scale, then one for the rest of its values together; work with no value there and work nobody
 * can place are among the largest where their figures put them, a chart of their own in the
 * neutral hue (`dayMultiples`, `SmallMultiples`). Each chart is in its
 * value's hue on the page (`slots`) and says its name, so the hue never speaks alone. Drawn, or as
 * its table, as every chart of the page is (`ChartSection`). A chart's name does what its value's
 * row does (`useLineMarks`): a task opens its card, a value the read can filter by goes out as
 * `narrow`.
 *
 * Split by a second dimension (`across`), the answer is read by both and each chart is a pair,
 * «claude-opus-5-5 · high», ranked, coloured and folded as a value is; it acts as its first value
 * does, as its bar does.
 *
 * Its heading is short, «Per day, by task», since the ranked list beside it already names the
 * measure and the dimension and the two stand on one line; the charts themselves are named whole.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import { useLineMarks } from '@/pages/analytics/composables/useLineActions.ts'
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
  /** The hue of each value, or each pair, on the page, by its key. */
  slots: ReadonlyMap<string, SeriesSlot>
  usage: Usage
  /** The second dimension the section is split by, which `usage` is read by too; null for none. */
  across?: UsageDimension | null
}>()
/** A value pressed to narrow the view to it: its filter value, and its name. */
const emit = defineEmits<{ narrow: [value: string | null, label: string] }>()

const { t } = useI18n()
const words = useSpendingWords()

const heading = computed(() =>
  t(`analytics.panel.multiples.heading.${props.usage.period.step}`, {
    by: words.breakdownBy(props.by, props.across),
  }),
)
const title = computed(() =>
  t('analytics.panel.multiples.title', {
    measure: words.measure(props.measure),
    per: words.per(props.usage.period.step),
    by: words.breakdownBy(props.by, props.across),
  }),
)

const drawn = computed(() => dayMultiples(props))
const marks = useLineMarks({
  by: () => props.by,
  lines: () => drawn.value.map(({ line }) => line),
  narrow: (value, label) => emit('narrow', value, label),
})

const multiples = computed<SmallMultiple[]>(() =>
  drawn.value.map(({ line, values }) => ({
    key: line.key,
    label: words.lineLabel(props.by, line),
    // Work with no value is charted as a value is, on the same scale; the folded tail stands apart.
    kind: line.kind === 'other' ? 'other' : 'category',
    slot: props.slots.get(line.key) ?? 'other',
    values,
    valueText: words.lineFigure(props.measure, line.spent),
    ...marks.markOf(line),
  })),
)

const periods = computed(() =>
  props.usage.series.map((point) => ({
    key: point.start,
    label: words.stepName(point.start, props.usage.period.step).label,
  })),
)

const chartWords = computed<MultiplesWords>(() => ({
  category: words.breakdownName(props.by, props.across),
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
    :title="heading"
    :narrow="narrow"
  >
    <template #chart>
      <SmallMultiples
        :label="title"
        :multiples="multiples"
        :periods="periods"
        :words="chartWords"
        :format-share="words.markShare"
        :format-value="formatValue"
        :value-axis="valueAxis"
        @follow="marks.follow"
        @select="marks.select"
      />
    </template>
    <template #table>
      <SmallMultiplesTable
        :label="title"
        :multiples="multiples"
        :periods="periods"
        :words="chartWords"
        :format-value="formatValue"
        @follow="marks.follow"
        @select="marks.select"
      />
    </template>
  </ChartSection>
</template>
