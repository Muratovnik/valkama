<script setup lang="ts">
/**
 * The panel of the period's tokens by kind, laid out as a dimension's panel is: how the kinds
 * split the tokens, as a ring (`DonutChart`) or as ranked bars (`RankedBars`), beside a small
 * chart of the period for each on one scale (`SmallMultiples`), and under them the table of each
 * kind beside the period before (`TokenKindsTable`). Every chart is drawn or read as its table, as
 * every chart of the page is (`ChartSection`); the split opens on its ring, as `firstSplitView`
 * says of a few parts, and its table ranks the kinds (`RankedBarsTable`).
 *
 * The kinds the tokens figure counts — input, the cache writes, output — are the ring's sectors
 * and the ranked bars, each in its own hue (`KIND_SLOTS`), and add up to the «Tokens» figure of
 * the summary, which the panel says at its top. The cache reads and the reasoning, a part of
 * output, close the chart as notes with their figures, under the ring's legend or under the bars,
 * and are no part of its whole: the summary leaves them out as well, and no bar's share counts
 * them.
 *
 * It reads the page's own answer, whatever dimension that was read by: its total and its steps
 * hold the tokens by kind. An answer whose period before could not be read says so at the top.
 * What the tokens count and leave apart is no line of the panel: the «ⓘ» of its heading says it
 * once (`useSectionCaveats`).
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import PanelLevel from '@/pages/analytics/components/PanelLevel.vue'
import SpendingUnread from '@/pages/analytics/components/SpendingUnread.vue'
import TokenKindsTable from '@/pages/analytics/components/TokenKindsTable.vue'
import { useKindWords } from '@/pages/analytics/composables/useKindWords.ts'
import { useNarrowCharts } from '@/pages/analytics/composables/useNarrowCharts.ts'
import { useSectionCaveats } from '@/pages/analytics/composables/useSectionCaveats.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { firstSplitView } from '@/pages/analytics/utils/splitView.ts'
import type { SplitView } from '@/pages/analytics/utils/splitView.ts'
import { countedTotal, KIND_SLOTS, kindLines } from '@/pages/analytics/utils/tokenKinds.ts'

import type { Usage } from '@/shared/api/analyticsApi.ts'
import type { RankedRow, RankedWords } from '@/shared/ui/chartGeometry.ts'
import DonutChart from '@/shared/ui/DonutChart.vue'
import type { DonutWords } from '@/shared/ui/DonutChart.vue'
import type { MultiplesWords, SmallMultiple } from '@/shared/ui/multiplesGeometry.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'
import SmallMultiples from '@/shared/ui/SmallMultiples.vue'
import SmallMultiplesTable from '@/shared/ui/SmallMultiplesTable.vue'

const props = defineProps<{ usage: Usage }>()
/** Read the answer again, its period before with it. */
const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
const caveats = useSectionCaveats()
/** What the tokens count, and of minutes their estimate, which the heading's «ⓘ» says. */
const about = computed(() => caveats.kinds(props.usage))
const words = useSpendingWords()
const kindWords = useKindWords()

const lines = computed(() => kindLines(props.usage))
const counted = computed(() => countedTotal(lines.value))
const total = computed(() => kindWords.count(counted.value))

const root = ref<HTMLElement | null>(null)
const narrow = useNarrowCharts(root)

const barsTitle = computed(() => t('analytics.kinds.bars'))
/** The kinds are no dimension's values, and a few: the split opens as the rule says of a few. */
const views: readonly SplitView[] = ['ring', 'bars']
const first = firstSplitView(null)
const bars = computed<RankedRow[]>(() =>
  lines.value.map((line) => ({
    key: line.kind,
    label: kindWords.name(line),
    value: line.count ?? 0,
    valueText: kindWords.count(line.count),
    kind: line.counted ? 'category' : 'other',
    slot: KIND_SLOTS.get(line.kind) ?? 'other',
  })),
)
const barWords = computed<RankedWords>(() => ({
  category: t('analytics.kinds.kind'),
  value: words.measure('tokens'),
  empty: t('analytics.bars.empty'),
}))
const ringWords = computed<DonutWords>(() => ({
  empty: t('analytics.bars.empty'),
  rest: (count) => t('analytics.values.other', { count }, count),
}))

/** The chart's full name; its section heading is the short form of the same, as the sibling's is. */
const multiplesTitle = computed(() =>
  t('analytics.kinds.multiples', { per: words.per(props.usage.period.step) }),
)
const multiplesHeading = computed(() => t(`analytics.kinds.heading.${props.usage.period.step}`))
/**
 * A chart of each counted kind on one scale; the cache reads stand apart, by their figure alone,
 * since they would dwarf the rest. The reasoning is already drawn inside output.
 */
const multiples = computed<SmallMultiple[]>(() =>
  lines.value
    .filter((line) => line.counted || line.kind === 'cached_read')
    .map((line) => ({
      key: line.kind,
      label: kindWords.name(line),
      kind: line.counted ? 'category' : 'none',
      slot: KIND_SLOTS.get(line.kind) ?? 'other',
      values: line.steps,
      valueText: kindWords.count(line.count),
    })),
)
const periods = computed(() =>
  props.usage.series.map((point) => ({
    key: point.start,
    label: words.stepName(point.start, props.usage.period.step).label,
  })),
)
const multiplesWords = computed<MultiplesWords>(() => ({
  category: t('analytics.kinds.kind'),
  empty: t('analytics.bars.empty'),
  scale: t('analytics.panel.multiples.scale'),
  total: t('analytics.panel.multiples.period'),
  absent: t('analytics.days.absent.tokens'),
}))
const formatValue = (amount: number) => words.scale('tokens', amount)
</script>

<template>
  <div
    ref="root"
    class="kinds-panel"
  >
    <PanelLevel
      level="section"
      as="div"
      :title="t('analytics.kinds.section')"
      :about="about"
    >
      <SpendingUnread
        v-if="!usage.comparison"
        @retry="emit('retry')"
      />
      <p class="kinds-figure">
        <span class="kinds-figure-name">{{ t('analytics.kinds.total') }}</span>
        <span class="kinds-figure-value">{{ total }}</span>
      </p>
      <div class="kinds-pair">
        <ChartSection
          class="kinds-bars"
          :title="barsTitle"
          :narrow="narrow"
          :views="views"
          :first="first"
        >
          <template #chart="{ view }">
            <DonutChart
              v-if="view === 'ring'"
              :label="barsTitle"
              :rows="bars"
              :words="ringWords"
              :format-value="formatValue"
              :format-part="words.share"
              :format-share="words.markShare"
            />
            <!-- The shares are of the counted kinds alone, the tokens figure. -->
            <RankedBars
              v-else
              :label="barsTitle"
              :rows="bars"
              :words="barWords"
              :whole="counted ?? 0"
              :format-share="words.markShare"
            />
          </template>
          <template #table>
            <RankedBarsTable
              :label="barsTitle"
              :rows="bars"
              :words="barWords"
            />
          </template>
        </ChartSection>
        <ChartSection
          class="kinds-multiples"
          :title="multiplesHeading"
          :narrow="narrow"
        >
          <template #chart>
            <SmallMultiples
              :label="multiplesTitle"
              :multiples="multiples"
              :periods="periods"
              :words="multiplesWords"
              :format-share="words.markShare"
              :format-value="formatValue"
            />
          </template>
          <template #table>
            <SmallMultiplesTable
              :label="multiplesTitle"
              :multiples="multiples"
              :periods="periods"
              :words="multiplesWords"
              :format-value="formatValue"
            />
          </template>
        </ChartSection>
      </div>
      <TokenKindsTable
        :lines="lines"
        :total="total"
        :compared="usage.comparison?.period ?? null"
      />
    </PanelLevel>
  </div>
</template>

<style scoped>
/* A section of the panel: the figures, the two charts and the table one under the next, each as
   tall as it is, in the panel's one scroll (`PanelLevel`). */
.kinds-panel {
  min-width: 0;
  container-type: inline-size;
}

.kinds-figure {
  display: flex;
  gap: var(--space-2);
  align-items: baseline;
  margin: 0;
}

.kinds-figure-name {
  color: var(--color-text-muted);
  font: var(--font-name);
}

.kinds-figure-value {
  font: var(--font-section-title);
  font-variant-numeric: tabular-nums;
}

/* The ranked kinds first, and their small charts beside them where both read well, a block's
   air apart. */
.kinds-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-4);
  align-items: start;
}

@container (width >= 48rem) {
  .kinds-pair {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
