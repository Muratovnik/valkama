<script setup lang="ts">
/**
 * One card of the overview: the first five values of a dimension in the page's measure, each a
 * row with its name, a bar on the card's own scale and its figure. Only values: the folded tail,
 * work with no value and work nobody can place are no answer to «which ones», and the
 * dimension's own section lists them.
 *
 * The heading opens that section. A row acts as a bar of the breakdown does (`useLineActions`):
 * a task is a link to its card, a value the read can filter by narrows the view to it, sent out
 * as `narrow`. A card whose values are being read for the first time, or could not be, says so in
 * one quiet line; one being read again keeps what it showed.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLineActions } from '@/pages/analytics/composables/useLineActions.ts'
import { useOverviewWords } from '@/pages/analytics/composables/useOverviewWords.ts'
import type { OverviewCard } from '@/pages/analytics/composables/useOverviewWords.ts'
import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import type { TopRead } from '@/pages/analytics/composables/useTopValues.ts'
import { measureOf, spendingLines } from '@/pages/analytics/utils/usageFigures.ts'
import type { SpendingLine } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { RankedRow } from '@/shared/ui/chartGeometry.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
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
const actions = useLineActions()

/** How many values a card names. */
const FIRST = 5

const heading = computed(() => overviewWords.cardTitle(props.dimension))

/** The values read, or null while they are read for the first time or could not be. */
const values = computed(() => (Array.isArray(props.read) ? props.read : null))
/** What the card says in their place. */
const waiting = computed(() =>
  props.read === 'failed'
    ? t('analytics.overview.cards.failed')
    : t('analytics.overview.cards.reading'),
)

const lines = computed(() =>
  values.value
    ? spendingLines(values.value, props.dimension, props.measure, FIRST)
        .filter((line) => line.kind === 'category')
        .slice(0, FIRST)
    : [],
)
const byKey = computed(() => new Map(lines.value.map((line) => [line.key, line])))

function acting(line: SpendingLine, label: string): Partial<RankedRow> {
  const href = actions.taskLink(props.dimension, line.value)?.href
  if (href) return { href }
  if (actions.narrowsTo(props.dimension, line.value) === undefined) return {}
  return { actionable: true, action: actions.narrowName(label) }
}

const rows = computed<RankedRow[]>(() =>
  lines.value.map((line) => {
    const label = words.lineLabel(props.dimension, line)
    return {
      key: line.key,
      label,
      detail: words.valueDetail(props.dimension, line.value),
      value: measureOf(props.measure, line.spent) ?? 0,
      valueText: words.lineFigure(props.measure, line.spent),
      ...acting(line, label),
    }
  }),
)

function follow(key: string, event: MouseEvent) {
  const link = actions.taskLink(props.dimension, byKey.value.get(key)?.value ?? null)
  if (link) actions.follow(link, event)
}

function select(key: string) {
  const line = byKey.value.get(key)
  const value = actions.narrowsTo(props.dimension, line?.value ?? null)
  if (line && value !== undefined) emit('narrow', value, words.lineLabel(props.dimension, line))
}

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
    <h3 class="overview-top-head">
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
    </h3>
    <RankedBars
      v-if="values"
      :label="heading"
      :rows="rows"
      :words="barWords"
      dense
      @follow="follow"
      @select="select"
    />
    <DataEmptyState
      v-else
      :title="waiting"
      inline
    />
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
