<script setup lang="ts">
/**
 * The period's measure broken down by the chosen dimension, largest first (`rankedLines`): work
 * with no task and work nobody can place stand among the values where their figures put them, with
 * a bar on the same scale in the neutral hue and their names in the quiet ink, since work on no
 * task can be the largest share of a period. Each bar is passed its amount in the measure's own
 * units, hours and not a share. A bar takes its value's hue on the page (`slots`), the neutral for
 * a value the day chart folds away. A value named by the start of its id, an account, carries the
 * whole id as its detail.
 *
 * It lists the first twelve values; past them one line says how many more there are and, pressed,
 * asks for the table, sent out as `more`, since the table lists them all (`SpendingTableLink`).
 *
 * A bar acts as its value does (`useRankedLines`): by task, a task's bar is a link to it; a value
 * the read can filter by — work with no task, or any value of another dimension it can — is a
 * control that narrows the view to it, sent out as `narrow`. The rows that are neither stay lines
 * of the chart.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import SpendingTableLink from '@/pages/analytics/components/SpendingTableLink.vue'
import { useRankedLines } from '@/pages/analytics/composables/useRankedLines.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { rankedLines } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageRow } from '@/shared/api/analyticsApi.ts'
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'

const props = defineProps<{
  by: UsageDimension
  measure: Measure
  narrow: boolean
  rows: readonly UsageRow[]
  /** The hue of each value on the page, by its key. */
  slots: ReadonlyMap<string, SeriesSlot>
  /** Why the last press here did not narrow the view, in words; empty otherwise. */
  notice?: string
}>()
/** A value pressed to narrow the view to it: its filter value, and its name; the table asked for. */
const emit = defineEmits<{ more: []; narrow: [value: string | null, label: string] }>()

/** How many values the list names before it leaves the rest to the table. */
const LISTED = 12

const { t } = useI18n()
const words = useSpendingWords()

const title = computed(() => words.chartTitle(props.measure, props.by))

const all = computed(() =>
  rankedLines(props.rows, props.by, props.measure, Number.POSITIVE_INFINITY),
)
const lines = computed(() => all.value.slice(0, LISTED))
/** How many values the list leaves to the table; none while it lists them all. */
const unlisted = computed(() => all.value.length - lines.value.length)
const moreWords = computed(() =>
  t('analytics.panel.bars.more', { count: unlisted.value }, unlisted.value),
)
const {
  rows: bars,
  follow,
  select,
} = useRankedLines({
  by: () => props.by,
  lines: () => lines.value,
  measure: () => props.measure,
  narrow: (value, label) => emit('narrow', value, label),
  more: (line) => ({
    kind: line.kind,
    slot: props.slots.get(line.key) ?? 'other',
  }),
})

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
        rank-all
        @follow="follow"
        @select="select"
      />
      <SpendingTableLink
        v-if="unlisted"
        class="spending-bars-more"
        @press="emit('more')"
      >
        {{ moreWords }}
      </SpendingTableLink>
    </template>
    <template #table>
      <RankedBarsTable
        :label="title"
        :rows="bars"
        :words="barWords"
        rank-all
        @follow="follow"
        @select="select"
      />
      <SpendingTableLink
        v-if="unlisted"
        class="spending-bars-more"
        @press="emit('more')"
      >
        {{ moreWords }}
      </SpendingTableLink>
    </template>
  </ChartSection>
</template>
