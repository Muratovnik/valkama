<script setup lang="ts">
/**
 * What one answer of the usage read says: the period's figures, which also choose the measure,
 * and the charts that break that measure down by the chosen dimension. A report narrower than a
 * chart reads well (`NARROW`) opens each chart as its table.
 */
import { computed, ref } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import SpendingBars from '@/pages/analytics/components/SpendingBars.vue'
import SpendingDays from '@/pages/analytics/components/SpendingDays.vue'
import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import type { AccountsRead } from '@/pages/analytics/composables/useUsageRead.ts'
import { spentOf } from '@/pages/analytics/utils/usageFigures.ts'

import type { Measure } from '@/shared/api/analyticsAddress.ts'
import type { Usage, UsageDimension } from '@/shared/api/analyticsApi.ts'

const props = defineProps<{
  /** The period by account behind the answer, for where the accounts that worked changed. */
  accounts: AccountsRead
  /** When the answer was asked for, which says which day is not over yet. */
  readAt: Date
  usage: Usage
}>()
const measure = defineModel<Measure>('measure', { required: true })

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
</script>

<template>
  <div
    ref="root"
    class="spending-report"
  >
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
      :rows="usage.rows"
    />
    <SpendingDays
      :accounts="accounts"
      :by="by"
      :measure="measure"
      :narrow="narrow"
      :read-at="readAt"
      :usage="usage"
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
