<script setup lang="ts">
/**
 * The panel of the period's tokens by kind, laid out as a dimension's panel is: the kinds ranked
 * (`RankedBars`) beside a small chart of the period for each on one scale (`SmallMultiples`), and
 * under them the table of each kind beside the period before (`TokenKindsTable`). Every chart is
 * drawn or read as its table, as every chart of the page is (`ChartSection`).
 *
 * The kinds the tokens figure counts — input, the cache writes, output — rank with a bar, each in
 * its own hue (`KIND_SLOTS`), and add up to the «Tokens» figure of the summary, which the panel
 * says at its top. The cache reads and the reasoning, a part of output, stand after them as notes
 * with their figures and no bar, and never set a scale: the summary leaves them out as well.
 *
 * It reads the page's own answer, whatever dimension that was read by: its total and its steps
 * hold the tokens by kind. An answer whose period before could not be read says so at the top.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import ChartSection from '@/pages/analytics/components/ChartSection.vue'
import SpendingUnread from '@/pages/analytics/components/SpendingUnread.vue'
import TokenKindsTable from '@/pages/analytics/components/TokenKindsTable.vue'
import { useKindWords } from '@/pages/analytics/composables/useKindWords.ts'
import { useNarrowCharts } from '@/pages/analytics/composables/useNarrowCharts.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { countedTotal, KIND_SLOTS, kindLines } from '@/pages/analytics/utils/tokenKinds.ts'

import type { Usage } from '@/shared/api/analyticsApi.ts'
import type { RankedRow, RankedWords } from '@/shared/ui/chartGeometry.ts'
import type { MultiplesWords, SmallMultiple } from '@/shared/ui/multiplesGeometry.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'
import SmallMultiples from '@/shared/ui/SmallMultiples.vue'
import SmallMultiplesTable from '@/shared/ui/SmallMultiplesTable.vue'

const props = defineProps<{ usage: Usage }>()
/** Read the answer again, its period before with it. */
const emit = defineEmits<{ retry: [] }>()

const { t } = useI18n()
const words = useSpendingWords()
const kindWords = useKindWords()

const lines = computed(() => kindLines(props.usage))
const total = computed(() => kindWords.count(countedTotal(lines.value)))

const root = ref<HTMLElement | null>(null)
const narrow = useNarrowCharts(root)

const barsTitle = computed(() => t('analytics.kinds.bars'))
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
    <SpendingUnread
      v-if="!usage.comparison"
      @retry="emit('retry')"
    />
    <div class="kinds-head">
      <p class="kinds-figure">
        <span class="kinds-figure-name">{{ t('analytics.kinds.total') }}</span>
        <span class="kinds-figure-value">{{ total }}</span>
      </p>
      <p class="kinds-note">
        {{ t('analytics.panel.table.kinds.note') }}
      </p>
    </div>
    <div class="kinds-pair">
      <ChartSection
        class="kinds-bars"
        :title="barsTitle"
        :narrow="narrow"
      >
        <template #chart>
          <RankedBars
            :label="barsTitle"
            :rows="bars"
            :words="barWords"
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
            :words="multiplesWords"
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
  </div>
</template>

<style scoped>
/* The figures, the two charts and the table one under the next, each as tall as it is, in the
   panel's one scroll. */
.kinds-panel {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-section);
  align-content: start;
  min-width: 0;
  container-type: inline-size;
}

.kinds-head {
  display: grid;
  gap: var(--space-1);
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

.kinds-note {
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* The ranked kinds first, and their small charts beside them where both read well. */
.kinds-pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-section);
  align-items: start;
}

@container (width >= 48rem) {
  .kinds-pair {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
