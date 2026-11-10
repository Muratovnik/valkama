<script setup lang="ts">
/**
 * The period's measure broken down by the chosen dimension, largest first: the categories, the
 * rest folded into «other», then work with no task and work nobody can place — three rows that
 * are never one. Each bar is passed its amount in the measure's own units, hours and not a share,
 * and the rows add up to the figure on the tile above.
 */
import { computed } from 'vue'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { Measure } from '@/pages/analytics/utils/analyticsAddress.ts'
import { measureOf, spendingLines } from '@/pages/analytics/utils/usageFigures.ts'

import type { UsageDimension, UsageRow } from '@/shared/api/analyticsApi.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'

const props = defineProps<{
  by: UsageDimension
  measure: Measure
  narrow: boolean
  rows: readonly UsageRow[]
}>()

const words = useSpendingWords()

const title = computed(() => words.chartTitle(props.measure, props.by))

const bars = computed<RankedRow[]>(() =>
  spendingLines(props.rows, props.by, props.measure).map((line) => ({
    key: line.key,
    kind: line.kind,
    label: words.lineLabel(props.by, line),
    value: measureOf(props.measure, line.spent) ?? 0,
    valueText: words.lineFigure(props.measure, line.spent),
  })),
)

const barWords = computed(() => ({
  category: words.dimension(props.by),
  value: words.measure(props.measure),
  empty: words.figure(props.measure, { seconds: 0, tokens: null, cost: null, unpriced: 0 }),
}))
</script>

<template>
  <ChartSection
    class="spending-bars"
    :title="title"
    :narrow="narrow"
  >
    <template #chart>
      <RankedBars
        :label="title"
        :rows="bars"
        :words="barWords"
      />
    </template>
    <template #table>
      <RankedBarsTable
        :label="title"
        :rows="bars"
        :words="barWords"
      />
    </template>
  </ChartSection>
</template>
