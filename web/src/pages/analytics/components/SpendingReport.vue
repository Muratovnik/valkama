<script setup lang="ts">
/**
 * What one answer of the usage read says: the period's figures, which also choose the measure,
 * and the charts that break that measure down.
 */
import { computed } from 'vue'

import SpendingTiles from '@/pages/analytics/components/SpendingTiles.vue'
import type { Measure } from '@/pages/analytics/utils/analyticsAddress.ts'
import { spentOf } from '@/pages/analytics/utils/usageFigures.ts'

import type { Usage } from '@/shared/api/analyticsApi.ts'

const props = defineProps<{ usage: Usage }>()
const measure = defineModel<Measure>('measure', { required: true })

const total = computed(() => spentOf(props.usage.total))
const before = computed(() => {
  const { comparison } = props.usage
  return comparison ? { ...comparison.period, spent: spentOf(comparison.total) } : null
})
</script>

<template>
  <div class="spending-report">
    <SpendingTiles
      v-model:measure="measure"
      :total="total"
      :before="before"
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
