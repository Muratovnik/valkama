<script setup lang="ts">
/**
 * The heading row over a dimension's table (`SpendingTable`): its title and its controls — one
 * its panel may set (`actions`), the second dimension, and the download of what it shows, in that
 * order. With no value to list the download is disabled, and words say why.
 *
 * Under it a line says in a few words how many values of the period the table lists in the
 * measure, how many spent nothing there and how many spent only before it, «2 roles · 1 with no
 * agent time · 237 outside the period», with the whole account of its rows and their order in its
 * hint. The line is a row of its own, so its words are whole however many parts the measure gives
 * it: beside the title and the controls it was cut in half under the measure «tokens». Where even
 * its row is too narrow it breaks between its parts, never inside one. It keeps its place while
 * there is nothing to count, so choosing a measure or a second dimension moves nothing under it.
 *
 * The title and the controls keep one line; only a narrow table lets them wrap.
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import { useSpendingWords } from '@/pages/analytics/composables/useSpendingWords.ts'
import { tableCounts } from '@/pages/analytics/composables/useTableModel.ts'
import type { TableLine } from '@/pages/analytics/composables/useTableModel.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { UsageDimension } from '@/shared/api/analyticsApi.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import SectionHeader from '@/shared/ui/SectionHeader.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  /** The second dimension the table is crossed with; null for none. */
  across: UsageDimension | null
  by: UsageDimension
  /** The dimensions the table may be crossed with. */
  dimensions: readonly UsageDimension[]
  /** The rows the table lists. */
  lines: readonly TableLine[]
  /** The measure the rows are counted in: a value with nothing there is said apart. */
  measure: Measure
  /** The whole account of the rows and their order, the hint of the words about them. */
  summary: string
  title: string
  /** A second dimension is chosen and its read has not landed: nothing to count or download. */
  waiting: boolean
}>()
/** The download asked for; a second dimension chosen, or none. */
const emit = defineEmits<{
  'download': []
  'update:across': [across: UsageDimension | null]
}>()

const { t } = useI18n()
const words = useSpendingWords()

/**
 * How many values of the period the rows are, as the rail's tile counts them; how many spent in
 * it nothing in the measure; and how many spent only before it.
 */
const parts = computed(() => {
  if (props.waiting || !props.lines.length) return []
  const { now, elsewhere, before } = tableCounts(props.lines)
  return [
    t(`analytics.panel.table.counts.values.${props.by}`, { count: now }, now),
    elsewhere
      ? t(`analytics.panel.table.counts.elsewhere.${props.measure}`, { count: elsewhere })
      : '',
    before ? t('analytics.panel.table.counts.outside', { count: before }) : '',
  ].filter(Boolean)
})
const counts = computed(() => parts.value.join(' · '))
/**
 * The parts as the line sets them, each but the last closed by its separator: the line breaks
 * between parts and so never starts with one. The space after it is the words' and not the
 * layout's, which drops it at a part's end: the line reads «2 roles · 1 with no agent time».
 */
const shownParts = computed(() =>
  parts.value.map((part, index, all) => (index < all.length - 1 ? `${part} · ` : part)),
)

const NONE = 'none'
const acrossOptions = computed(() => [
  { value: NONE, label: t('analytics.panel.table.acrossNone') },
  ...props.dimensions
    .filter((dimension) => dimension !== props.by)
    .map((dimension) => ({ value: dimension, label: words.dimension(dimension) })),
])
function chooseAcross(value: string) {
  const chosen = props.dimensions.find((dimension) => dimension === value)
  emit('update:across', chosen ?? null)
}

/** Nothing to download: no value to list. */
const nothing = computed(() => !props.lines.length)
const nothingId = useId()
const downloadNote = computed(() => (nothing.value ? nothingId : undefined))
</script>

<template>
  <div class="spending-table-head">
    <SectionHeader
      class="spending-table-title"
      as="h2"
      level="page"
      :title="title"
    />
    <div class="spending-table-controls">
      <slot name="actions" />
      <ChoiceSelect
        class="spending-table-across"
        size="compact"
        :label="t('analytics.panel.table.across')"
        :model-value="across ?? NONE"
        :options="acrossOptions"
        @update:model-value="chooseAcross"
      />
      <span
        v-if="nothing"
        :id="nothingId"
        class="spending-table-note"
      >
        {{ t('analytics.table.nothingToDownload') }}
      </span>
      <VButton
        class="spending-download"
        size="compact"
        :disabled="nothing || waiting"
        :aria-describedby="downloadNote"
        @click="emit('download')"
      >
        {{ t('analytics.table.download') }}
      </VButton>
    </div>
    <div class="spending-table-counts">
      <p
        v-if="parts.length"
        v-tooltip.detail="{ text: summary, words: counts }"
        class="spending-table-summary"
      >
        <span
          v-for="part in shownParts"
          :key="part"
          class="spending-table-count"
          >{{ part }}</span
        >
      </p>
    </div>
  </div>
</template>

<style scoped>
/* The title and the controls on one line, and the line about the rows on a row of its own
   under them, as wide as the table. */
.spending-table-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  align-items: center;
}

/* Its place is kept with nothing in it: a line of the detail's height. */
.spending-table-counts {
  flex: 1 0 100%;
  min-block-size: 1lh;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* Each part keeps its words together, «45 with no tokens ·»; the line breaks only between them. */
.spending-table-summary {
  display: flex;
  flex-wrap: wrap;
  column-gap: var(--space-1);
  margin: 0;
}

.spending-table-count {
  white-space: nowrap;
}

.spending-table-note {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.spending-table-controls {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  margin-inline-start: auto;
}

.spending-table-title,
.spending-table-controls {
  flex: none;
}

/* In a narrow table, as on a phone, the row wraps. Wrapped, the controls may be narrower than the
   three side by side: held to that width they would reach past a phone's edge. */
@container (width < 50rem) {
  .spending-table-head,
  .spending-table-controls {
    flex-wrap: wrap;
  }

  .spending-table-controls {
    flex: 0 1 auto;
  }
}
</style>
