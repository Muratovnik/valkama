<script setup lang="ts">
/**
 * The overview of what one answer of the usage read says: the period's figures, which also choose
 * the measure, and the period day by day in that measure. A report narrower than a chart reads well
 * (`NARROW`) opens the chart as its table. A dimension's section is its own panel
 * (`DimensionPanel`).
 *
 * An answer whose period before could not be read says so above the figures (`SpendingUnread`).
 * A day pressed to narrow the view goes out as `day`; why such a press was refused stands in the
 * days, the part of the report it was pressed in.
 */
import { computed, ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import SpendingUnread from '@/pages/analytics/components/SpendingUnread.vue'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import { spentOf } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage } from '@/shared/api/analyticsApi.ts'

/** Where in the page a press asked to narrow the view. */
export type ReportPart = 'bars' | 'days' | 'table'

const props = defineProps<{
  /** The period by account behind the answer, for where the accounts that worked changed. */
  accounts: AccountsRead
  /** When the answer was asked for, which says which day is not over yet. */
  readAt: Date
  /** Why the last press in a part of the page did not narrow the view; null otherwise. */
  refused: { part: ReportPart; words: string } | null
  usage: Usage
}>()
/** Read the answer again, for a period before that could not be read; narrow the view to a day. */
const emit = defineEmits<{ day: [day: string, label: string]; retry: [] }>()
const measure = defineModel<Measure>('measure', { required: true })

/** The overview breaks the days down by the dimension it was read by. */
const by = computed(() => props.usage.group_by[0] ?? 'work_item')
const total = computed(() => spentOf(props.usage.total))
const before = computed(() => {
  const { comparison } = props.usage
  return comparison ? { ...comparison.period, spent: spentOf(comparison.total) } : null
})

/** Under this width, in pixels, a row of a day's columns crowds its readout. */
const NARROW = 560
const root = ref<HTMLElement | null>(null)
const width = ref<number | null>(null)
useResizeObserver(root, ([entry]) => {
  if (entry) width.value = entry.contentRect.width
})
const narrow = computed(() => width.value !== null && width.value < NARROW)

const notice = computed(() => (props.refused?.part === 'days' ? props.refused.words : ''))
</script>

<template>
  <div
    ref="root"
    class="spending-report"
  >
    <SpendingUnread
      v-if="!before"
      @retry="emit('retry')"
    />
    <SpendingTiles
      v-model:measure="measure"
      :split="usage.total.tokens"
      :total="total"
      :before="before"
    />
    <SpendingDays
      :accounts="accounts"
      :by="by"
      :measure="measure"
      :narrow="narrow"
      :notice="notice"
      :read-at="readAt"
      :usage="usage"
      @day="(day, label) => emit('day', day, label)"
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
</style>
