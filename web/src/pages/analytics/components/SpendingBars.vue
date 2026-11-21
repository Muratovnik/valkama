<script setup lang="ts">
/**
 * The period's measure broken down by the chosen dimension, largest first (`rankedLines`): work
 * with no task and work nobody can place stand among the values where their figures put them, with
 * a bar on the same scale in the neutral hue and their names in the quiet ink, since work on no
 * task can be the largest share of a period; a list of free text, below, sets them apart with that
 * bar instead. Each bar is passed its amount in the measure's own
 * units, hours and not a share; its figure says its share of every value of the period after its
 * amount, «4 d 1 h · 78 %» (`lineShare`), the folded and the unlisted ones counted, so the bars
 * need no strip of the whole over them. A bar takes its value's hue on the page (`slots`), the
 * neutral for a value the day chart folds away. A session named by its title carries its client
 * and the start of its id as its detail; an account carries none, its whole id copied from the
 * quota panel.
 *
 * With the section split by a second dimension (`across`) the rows are of the read by both, and
 * each bar is a pair, «claude-opus-5-5 · high», ranked, coloured and folded as a value is; it acts
 * as its first value does.
 *
 * The bars list the first twelve values, and so does the table; past them one line, «All 30»,
 * counts every value of the period in the measure, as the rail's tile and the full table's heading
 * row do, and, pressed, opens the dimension's full table in the side panel, sent out as `all`
 * (`SpendingTableLink`); the line is found by `data-all`.
 *
 * The values split one whole, so a person can draw them as a ring instead (`DonutChart`): each
 * value a sector in its hue, named while its hue stays apart from the others' and the smaller
 * folded into one rest, which leaves no value to the table. The section opens on its ring. Split
 * by a second dimension, its pairs are ranked bars alone, since a ring of a pair each would tell
 * the pairs of one value apart by hue alone.
 *
 * Values named by free text, tasks and sessions, on either side of a pair (`namedByText`), are a
 * list only, switched with the table alone: the bars of a list of free text (`RankedBars`'s
 * `freeText`), each name on lines of its own. It lists the first
 * ten values, folds the rest into one row, and closes with it and work with no value under a rule,
 * each with its bar; the line under it still counts every value and opens the full table.
 *
 * A bar acts as its value does (`useRankedLines`): a value the read can filter by — a task, work
 * with no task, or any value of another dimension it can — opens its side panel, sent out as
 * `inspect`, and a task's bar is a link to its card as well. The rows that are neither stay lines
 * of the chart.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import SpendingTableLink from '@/pages/analytics/components/SpendingTableLink.vue'
import { useRankedLines } from '@/pages/analytics/composables/useRankedLines.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { namedByText } from '@/pages/analytics/utils/splitView.ts'
import {
  breakdownOf,
  drawnLines,
  measureOf,
  rankedLines,
  spendingLines,
  workedValue,
} from '@/pages/analytics/utils/usageFigures.ts'

import { MEASURES } from '@/shared/api/analyticsAddress.ts'
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
/** A value pressed to open its side panel: its filter value, and its name; the full table asked for. */
const emit = defineEmits<{ all: []; inspect: [value: string | null, label: string] }>()

/** How many values the list names before it leaves the rest to the full table. */
const LISTED = 12
/** How many values a list of free text names before it folds the rest into one row. */
const LISTED_TEXT = 10

const { t } = useI18n()
const words = useSpendingWords()

const title = computed(() => words.chartTitle(props.measure, props.by, props.across))
/** The title under every measure, whose room its heading row keeps. */
const titles = computed(() =>
  MEASURES.map((each) => words.chartTitle(each, props.by, props.across)),
)

/** Whether the values are named by free text, which is a list only. */
const listOnly = computed(() => namedByText(props.by, props.across))
/**
 * Every value ranked, none folded; for a list of free text the first ten, the rest folded into
 * one row, and work with no value and unknown work each a row apart.
 */
const all = computed(() => {
  const breakdown = breakdownOf(props.by, props.across)
  return listOnly.value
    ? spendingLines(props.rows, breakdown, props.measure, LISTED_TEXT)
    : rankedLines(props.rows, breakdown, props.measure, Number.POSITIVE_INFINITY)
})
/** The drawings offered: a ring or the bars, the bars alone for pairs, one list for free text. */
const views = computed(() => {
  if (listOnly.value) return ['chart'] as const
  return props.across ? (['bars'] as const) : (['ring', 'bars'] as const)
})
/** What every value adds up to, listed or not: what each bar's figure says its share of. */
const whole = computed(() =>
  all.value.reduce((sum, line) => sum + (measureOf(props.measure, line.spent) ?? 0), 0),
)
/** How many values the list and its table leave to the full table. */
const unlisted = computed(() =>
  listOnly.value
    ? (all.value.find((line) => line.kind === 'other')?.folded ?? 0)
    : Math.max(0, all.value.length - LISTED),
)
/**
 * Every value of the period in the measure, as the rail's tile and the full table's heading row
 * count them (`workedValue`): work with no value there, work nobody can place and a value that
 * spent only in another measure are rows of that table, not values of the count. Counted with
 * them, «All 31» stood beside the tile's «30 values» for one period.
 */
const counted = computed(
  () =>
    spendingLines(
      props.rows,
      breakdownOf(props.by, props.across),
      props.measure,
      Number.POSITIVE_INFINITY,
    ).filter((line) => workedValue(props.measure, line)).length,
)
const allWords = computed(() =>
  t('analytics.panel.bars.all', { count: counted.value }, counted.value),
)
/**
 * The lines every view of the chart draws — the ring and its legend, the bars and the table twin:
 * every one whose figure counts something (`drawnLines`), while its shares stay of every value.
 */
const drawn = computed(() => drawnLines(props.measure, all.value))
const ranked = useRankedLines({
  by: () => props.by,
  lines: () => drawn.value,
  measure: () => props.measure,
  whole: () => whole.value,
  inspect: (value, label) => emit('inspect', value, label),
  more: (line) => ({
    kind: line.kind,
    slot: props.slots.get(line.key) ?? 'other',
  }),
})
const { follow, select } = ranked
/**
 * The ring folds its own rest, so it is handed every value, each figure alone since its legend says
 * the shares; the list and its table the first, each figure with its share.
 */
const parts = computed(() => ranked.rows.value)
const bars = computed(() =>
  listOnly.value ? ranked.shared.value : ranked.shared.value.slice(0, LISTED),
)

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
    :titles="titles"
    :narrow="narrow"
    :notice="notice"
    :views="views"
  >
    <template #chart="{ view }">
      <DonutChart
        v-if="view === 'ring'"
        :label="title"
        :rows="parts"
        :whole="whole"
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
        :rank-all="!listOnly"
        :free-text="listOnly"
        @follow="follow"
        @select="select"
      />
      <SpendingTableLink
        v-if="unlisted && view !== 'ring'"
        class="spending-bars-more"
        data-all
        @press="emit('all')"
      >
        {{ allWords }}
      </SpendingTableLink>
    </template>
    <template #table>
      <RankedBarsTable
        :label="title"
        :rows="bars"
        :words="barWords"
        :rank-all="!listOnly"
        @follow="follow"
        @select="select"
      />
      <SpendingTableLink
        v-if="unlisted"
        class="spending-bars-more"
        data-all
        @press="emit('all')"
      >
        {{ allWords }}
      </SpendingTableLink>
    </template>
  </ChartSection>
</template>
