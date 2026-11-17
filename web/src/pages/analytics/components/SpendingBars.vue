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
 * With the section split by a second dimension (`across`) the rows are of the read by both, and
 * each bar is a pair, «claude-opus-5-5 · high», ranked, coloured and folded as a value is; it acts
 * as its first value does.
 *
 * The bars list the first twelve values, and so does the table; past them one line says how many
 * more there are and, pressed, asks for the section's full table, sent out as `more`, since that
 * table lists them all (`SpendingTableLink`).
 *
 * The values split one whole, so a person can draw them as a ring instead (`DonutChart`): each
 * value a sector in its hue, named while its hue stays apart from the others' and the smaller
 * folded into one rest, which leaves no value to the table. Which drawing the section opens on is
 * `firstSplitView`'s: the ring, but the bars by task. Split by a second dimension, its pairs are
 * ranked bars alone, since a ring of a pair each would tell the pairs of one value apart by hue
 * alone.
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
import { firstSplitView } from '@/pages/analytics/utils/splitView.ts'
import type { SplitView } from '@/pages/analytics/utils/splitView.ts'
import { breakdownOf, measureOf, rankedLines } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension, UsageRow } from '@/shared/api/analyticsApi.ts'
import type { SeriesSlot } from '@/shared/lib/seriesColors.ts'
import DonutChart from '@/shared/ui/DonutChart.vue'
import type { DonutWords } from '@/shared/ui/DonutChart.vue'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'

const props = defineProps<{
  by: UsageDimension
  measure: Measure
  narrow: boolean
  rows: readonly UsageRow[]
  /** The hue of each value, or each pair, on the page, by its key. */
  slots: ReadonlyMap<string, SeriesSlot>
  /** The second dimension the section is split by, which `rows` are read by too; null for none. */
  across?: UsageDimension | null
  /** Why the last press here did not narrow the view, in words; empty otherwise. */
  notice?: string
}>()
/** A value pressed to narrow the view to it: its filter value, and its name; the table asked for. */
const emit = defineEmits<{ more: []; narrow: [value: string | null, label: string] }>()

/** How many values the list names before it leaves the rest to the table. */
const LISTED = 12

const { t } = useI18n()
const words = useSpendingWords()

const title = computed(() => words.chartTitle(props.measure, props.by, props.across))

const all = computed(() =>
  rankedLines(
    props.rows,
    breakdownOf(props.by, props.across),
    props.measure,
    Number.POSITIVE_INFINITY,
  ),
)
/** The drawings offered: a ring or the bars, and the bars alone for pairs. */
const views = computed<SplitView[]>(() => (props.across ? ['bars'] : ['ring', 'bars']))
const first = computed(() => firstSplitView(props.by))
/** What every value adds up to, listed or not: what each bar's hint says its share of. */
const whole = computed(() =>
  all.value.reduce((sum, line) => sum + (measureOf(props.measure, line.spent) ?? 0), 0),
)
/** How many values the list and its table leave to the section's table. */
const unlisted = computed(() => Math.max(0, all.value.length - LISTED))
const moreWords = computed(() =>
  t('analytics.panel.bars.more', { count: unlisted.value }, unlisted.value),
)
const ranked = useRankedLines({
  by: () => props.by,
  lines: () => all.value,
  measure: () => props.measure,
  narrow: (value, label) => emit('narrow', value, label),
  more: (line) => ({
    kind: line.kind,
    slot: props.slots.get(line.key) ?? 'other',
  }),
})
const { follow, select } = ranked
/** The ring folds its own rest, so it is handed every value; the list and its table the first. */
const parts = computed(() => ranked.rows.value)
const bars = computed(() => parts.value.slice(0, LISTED))

/** A breakdown with no row is a period that spent nothing, in whatever measure it is drawn. */
const barWords = computed(() => ({
  category: words.breakdownName(props.by, props.across),
  value: words.measure(props.measure),
  empty: t('analytics.bars.empty'),
}))
const ringWords = computed<DonutWords>(() => ({
  empty: t('analytics.bars.empty'),
  rest: (count) => t('analytics.values.other', { count }, count),
}))
const formatValue = (amount: number) => words.scale(props.measure, amount)
</script>

<template>
  <ChartSection
    class="spending-bars"
    :title="title"
    :narrow="narrow"
    :notice="notice"
    :views="views"
    :first="first"
  >
    <template #chart="{ view }">
      <DonutChart
        v-if="view === 'ring'"
        :label="title"
        :rows="parts"
        :words="ringWords"
        :format-value="formatValue"
        :format-part="words.share"
        :format-share="words.markShare"
        @follow="follow"
        @select="select"
      />
      <RankedBars
        v-else
        :label="title"
        :rows="bars"
        :words="barWords"
        :whole="whole"
        :format-share="words.markShare"
        rank-all
        @follow="follow"
        @select="select"
      />
      <SpendingTableLink
        v-if="unlisted && view !== 'ring'"
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
