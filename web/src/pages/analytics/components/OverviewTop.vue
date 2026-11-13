<script setup lang="ts">
/**
 * One card of the overview: the first five rows of a dimension in the page's measure, each a
 * row with its name, a bar on the card's own scale and its figure. Work with no value there and
 * work nobody can place are ranked by their figure among the values, since they can be most of
 * the period: their bar is the neutral, their name in the quiet ink, and they lead nowhere. The
 * folded tail is no answer to «which ones», and the dimension's own section lists it. A value's
 * bar is in its hue of the page (`rankedSlots`, over the period without the page's filters,
 * `useColourPlaces`), the one its tile and charts draw it in.
 *
 * The heading opens that section. A row acts as a bar of the breakdown does (`useRankedLines`):
 * a task is a link to its card, a value the read can filter by narrows the view to it, sent out
 * as `narrow`. A card whose values are being read for the first time, or could not be, says so in
 * one quiet line; one being read again keeps what it showed.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useColourPlaces } from '@/pages/analytics/composables/useColourPlaces.ts'
import { useOverviewWords } from '@/pages/analytics/composables/useOverviewWords.ts'
import type { OverviewCard } from '@/pages/analytics/composables/useOverviewWords.ts'
import { useHeadingUnder } from '@/pages/analytics/composables/usePanelOutline.ts'
import { useRankedLines } from '@/pages/analytics/composables/useRankedLines.ts'
import { useReadWaitReport } from '@/pages/analytics/composables/useReadWaits.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { TopRead } from '@/pages/analytics/composables/useTopValues.ts'
import { rankedSlots } from '@/pages/analytics/utils/dayFigures.ts'
import { figureOf, measureOf, spendingLines } from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { useLoadingPresence } from '@/shared/ui/loadingPresence.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  dimension: OverviewCard
  measure: Measure
  read: TopRead
}>()
/** The heading pressed, to open the section; a value pressed, to narrow the view to it. */
const emit = defineEmits<{ narrow: [value: string | null, label: string]; open: [] }>()

const { t } = useI18n()
const words = useSpendingWords()
const overviewWords = useOverviewWords()
/** The card's heading one under the level it stands in. */
const headingAs = useHeadingUnder()

/** How many values a card names. */
const FIRST = 5

const heading = computed(() => overviewWords.cardTitle(props.dimension))

/** The values read, or null while they are read for the first time or could not be. */
const values = computed(() => (Array.isArray(props.read) ? props.read : null))
/** The first read's wait, shown once it has lasted and held for the minimum (`useLoadingPresence`). */
const { shown } = useLoadingPresence(() => props.read === 'loading')
useReadWaitReport(shown)
/** The word on screen, once the wait has lasted. */
const waitWord = computed(() => (shown.value ? t('platform.states.loading') : ''))

const weight = (line: SpendingLine) => measureOf(props.measure, line.spent) ?? 0

/**
 * The first rows: values, no value and unknown work alike by their figure; never the tail, and
 * never a row with nothing in the period, which answers no «which ones».
 */
const lines = computed(() =>
  values.value
    ? spendingLines(values.value, props.dimension, props.measure, Number.POSITIVE_INFINITY)
        .filter((line) => line.kind !== 'other' && figureOf(props.measure, line.spent) !== 0)
        .sort((left, right) => weight(right) - weight(left))
        .slice(0, FIRST)
    : [],
)
const places = useColourPlaces()
const slots = computed(() =>
  values.value
    ? rankedSlots(places.rows(props.dimension) ?? values.value, props.dimension, props.measure)
    : new Map(),
)
const { rows, follow, select } = useRankedLines({
  by: () => props.dimension,
  lines: () => lines.value,
  measure: () => props.measure,
  more: (line) => ({
    slot: slots.value.get(line.key) ?? 'other',
    quiet: line.kind !== 'category',
  }),
  narrow: (value, label) => emit('narrow', value, label),
})

const barWords = computed(() => ({
  category: words.dimension(props.dimension),
  value: words.measure(props.measure),
  empty: t('analytics.overview.cards.empty'),
}))
</script>

<template>
  <section
    class="overview-top"
    :data-card="dimension"
  >
    <component
      :is="headingAs"
      class="overview-top-head"
    >
      <button
        type="button"
        class="overview-top-open"
        :aria-description="t('analytics.overview.cards.open')"
        @click="emit('open')"
      >
        {{ heading }}
        <VIcon
          name="chevron-right"
          :size="14"
        />
      </button>
    </component>
    <!-- A wait shown keeps the card's wait for its minimum, whatever arrives meanwhile. -->
    <RankedBars
      v-if="values && !shown"
      :label="heading"
      :rows="rows"
      :words="barWords"
      dense
      @follow="follow"
      @select="select"
    />
    <DataEmptyState
      v-else-if="read === 'failed' && !shown"
      :title="t('analytics.overview.cards.failed')"
      inline
    />
    <p
      v-else
      class="overview-top-wait"
    >
      {{ waitWord }}
    </p>
  </section>
</template>

<style scoped>
.overview-top {
  display: grid;
  grid-template-rows: auto 1fr;
  gap: var(--space-2);
  align-content: start;
  min-width: 0;
}

.overview-top-head {
  margin: 0;
  font: var(--font-field-label);
}

/* The first read's wait, one quiet line in the card's place: it keeps that place while held. */
.overview-top-wait {
  min-block-size: 1lh;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* The heading reads as one and opens its section: no ground of its own, the arrow says where. */
.overview-top-open {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-block-size: var(--size-control-inline);
  padding: 0 var(--space-2);
  margin-inline-start: calc(-1 * var(--space-2));
  border: 0;
  color: var(--color-text);
  font: inherit;
  background: none;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
  }
}
</style>
