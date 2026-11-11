<script setup lang="ts">
/**
 * The period's measure broken down by the chosen dimension, largest first: the categories, the
 * rest folded into «other», then work with no task and work nobody can place — three rows that
 * are never one. Each bar is passed its amount in the measure's own units, hours and not a share,
 * and the rows add up to the figure on the tile above.
 *
 * A bar acts as its value does (`useLineActions`): by task, a task's bar is a link to it; by any
 * other dimension, a value the read can filter by is a control that narrows the view to it, sent
 * out as `narrow`. The rows that are neither stay lines of the chart.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import { useLineActions } from '@/pages/analytics/composables/useLineActions.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { measureOf, spendingLines } from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageRow } from '@/shared/api/analyticsApi.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'

const props = defineProps<{
  by: UsageDimension
  measure: Measure
  narrow: boolean
  rows: readonly UsageRow[]
  /** Why the last press here did not narrow the view, in words; empty otherwise. */
  notice?: string
}>()
/** A value pressed to narrow the view to it: its filter value, and its name. */
const emit = defineEmits<{ narrow: [value: string | null, label: string] }>()

const { t } = useI18n()
const words = useSpendingWords()
const actions = useLineActions()

const title = computed(() => words.chartTitle(props.measure, props.by))

const lines = computed(() => spendingLines(props.rows, props.by, props.measure))
const byKey = computed(() => new Map(lines.value.map((line) => [line.key, line])))

/** What pressing a line does, as a bar carries it: where it leads, or what it narrows to. */
function acting(line: SpendingLine, label: string): Partial<RankedRow> {
  const href = actions.taskLink(props.by, line.value)?.href
  if (href) return { href }
  if (actions.narrowsTo(props.by, line.value) === undefined) return {}
  return { actionable: true, action: actions.narrowName(label) }
}

const bars = computed<RankedRow[]>(() =>
  lines.value.map((line) => {
    const label = words.lineLabel(props.by, line)
    return {
      key: line.key,
      kind: line.kind,
      label,
      value: measureOf(props.measure, line.spent) ?? 0,
      valueText: words.lineFigure(props.measure, line.spent),
      ...acting(line, label),
    }
  }),
)

function follow(key: string, event: MouseEvent) {
  const link = actions.taskLink(props.by, byKey.value.get(key)?.value ?? null)
  if (link) actions.follow(link, event)
}

function select(key: string) {
  const line = byKey.value.get(key)
  const value = actions.narrowsTo(props.by, line?.value ?? null)
  if (line && value !== undefined) emit('narrow', value, words.lineLabel(props.by, line))
}

/** A breakdown with no row is a period that spent nothing, in whatever measure it is drawn. */
const barWords = computed(() => ({
  category: words.dimension(props.by),
  value: words.measure(props.measure),
  empty: t('analytics.bars.empty'),
}))
</script>

<template>
  <ChartSection
    class="spending-bars"
    :title="title"
    :narrow="narrow"
    :notice="notice"
  >
    <template #chart>
      <RankedBars
        :label="title"
        :rows="bars"
        :words="barWords"
        @follow="follow"
        @select="select"
      />
    </template>
    <template #table>
      <RankedBarsTable
        :label="title"
        :rows="bars"
        :words="barWords"
        @follow="follow"
        @select="select"
      />
    </template>
  </ChartSection>
</template>
