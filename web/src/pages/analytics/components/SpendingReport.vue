<script setup lang="ts">
/**
 * What one answer of the usage read says: the period's figures, which also choose the measure,
 * the charts that break that measure down by the chosen dimension, and under them every value of
 * that dimension in a table beside the period before. A report narrower than a chart reads well
 * (`NARROW`) opens each chart as its table.
 *
 * An answer whose period before could not be read says so above the figures, as a status a
 * screen reader hears too, with the page's own way to read it again; the figures stand, with no
 * change beside them.
 *
 * A value or a day pressed to narrow the view goes out with the dimension the answer was read
 * by and the part of the report it was pressed in, which says why when it was refused.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useResizeObserver } from '@vueuse/core'

import SpendingBars from '@/pages/analytics/components/SpendingBars.vue'
import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingTable from '@/pages/analytics/components/SpendingTable.vue'
import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import { spentOf } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension, UsageFilters } from '@/shared/api/analyticsApi.ts'

/** Where in the report a press asked to narrow the view. */
export type ReportPart = 'bars' | 'days' | 'table'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  /** The period by account behind the answer, for where the accounts that worked changed. */
  accounts: AccountsRead
  /** The filters the answer was read with. */
  filters: UsageFilters
  /** When the answer was asked for, which says which day is not over yet. */
  readAt: Date
  /** Why the last press in a part of the report did not narrow the view; null otherwise. */
  refused: { part: ReportPart; words: string } | null
  usage: Usage
}>()
/**
 * Read the answer again, for a period before that could not be read; narrow the view to a value
 * of the answer's dimension, or to a day, as pressed in a part of the report.
 */
const emit = defineEmits<{
  day: [day: string, label: string]
  narrow: [dimension: UsageDimension, value: string | null, label: string, part: ReportPart]
  retry: []
}>()
const measure = defineModel<Measure>('measure', { required: true })

const { t } = useI18n()

/**
 * The dimension the answer was read by, not the one the page now asks for: while a new
 * breakdown is read the last one stays on screen, and its rows name only their own dimension.
 */
const by = computed<UsageDimension>(() => props.usage.group_by[0] ?? 'work_item')
const total = computed(() => spentOf(props.usage.total))
const before = computed(() => {
  const { comparison } = props.usage
  return comparison ? { ...comparison.period, spent: spentOf(comparison.total) } : null
})

/** Under this width, in pixels, a row of a day's columns and a bar's name crowd each other. */
const NARROW = 560
const root = ref<HTMLElement | null>(null)
const width = ref<number | null>(null)
useResizeObserver(root, ([entry]) => {
  if (entry) width.value = entry.contentRect.width
})
const narrow = computed(() => width.value !== null && width.value < NARROW)

/** The words of a refusal, in the part of the report it came from. */
const noticeIn = (part: ReportPart) => (props.refused?.part === part ? props.refused.words : '')
const notices = computed(() => ({
  bars: noticeIn('bars'),
  days: noticeIn('days'),
  table: noticeIn('table'),
}))
</script>

<template>
  <div
    ref="root"
    class="spending-report"
  >
    <div
      v-if="!before"
      class="spending-unread"
    >
      <p
        class="spending-unread-words"
        role="status"
      >
        {{ t('analytics.unread') }}
      </p>
      <VButton
        size="compact"
        @click="emit('retry')"
      >
        {{ t('platform.actions.retry') }}
      </VButton>
    </div>
    <SpendingTiles
      v-model:measure="measure"
      :split="usage.total.tokens"
      :total="total"
      :before="before"
    />
    <SpendingBars
      :by="by"
      :measure="measure"
      :narrow="narrow"
      :notice="notices.bars"
      :rows="usage.rows"
      @narrow="(value, label) => emit('narrow', by, value, label, 'bars')"
    />
    <SpendingDays
      :accounts="accounts"
      :by="by"
      :measure="measure"
      :narrow="narrow"
      :notice="notices.days"
      :read-at="readAt"
      :usage="usage"
      @day="(day, label) => emit('day', day, label)"
    />
    <SpendingTable
      :by="by"
      :filters="filters"
      :measure="measure"
      :notice="notices.table"
      :usage="usage"
      @narrow="(value, label) => emit('narrow', by, value, label, 'table')"
    />
  </div>
</template>

<style scoped>
.spending-report {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-section);
  min-width: 0;
}

/* What is missing from the answer, and the way to read it again: the words and the button on one
   line while they fit, the button under the words when they do not. A status edge on a muted
   ground, as the product marks a read that came back short. */
.spending-unread {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-inline-start: 3px solid var(--color-warning);
  background: var(--color-surface-muted);
}

.spending-unread-words {
  flex: 1 1 16rem;
  min-width: 0;
  margin: 0;
  color: var(--color-text);
  font: var(--font-detail);
}
</style>
