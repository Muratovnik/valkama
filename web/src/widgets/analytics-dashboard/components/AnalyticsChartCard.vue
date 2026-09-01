<script setup lang="ts">
/**
 * The panel a chart stands in, which five charts on this screen share.
 *
 * A card names what it shows, says where the figure came from, and offers the
 * numbers behind it. The trigger only appears when there is something to tabulate:
 * "open the table" on an empty chart promises rows it does not have, which is why
 * `hasData` decides both the figure and the trigger.
 */
import { useSlots } from 'vue'

import DataTableTrigger from '@/widgets/analytics-dashboard/components/DataTableTrigger.vue'

import DataEmptyState from '@/shared/ui/DataEmptyState.vue'

const { emptyCompact = true } = defineProps<{
  hasData: boolean
  hint: string
  title: string
  emptyCompact?: boolean
  emptyDescription?: string
  emptyTitle?: string
  headingId?: string
  hintId?: string
}>()

const emit = defineEmits<{ 'open-table': [] }>()
const slots = useSlots()
</script>

<template>
  <section class="chart-card">
    <header class="card-head">
      <div class="card-copy">
        <h3
          :id="headingId"
          class="card-title"
        >
          {{ title }}
        </h3>
        <p
          :id="hintId"
          class="card-hint"
        >
          {{ hint }}
        </p>
      </div>
      <div
        v-if="slots.actions"
        class="chart-head-actions"
      >
        <slot name="actions" />
      </div>
    </header>
    <slot v-if="hasData" />
    <DataEmptyState
      v-else
      :title="emptyTitle ?? ''"
      :description="emptyDescription ?? ''"
      :compact="emptyCompact"
    />
    <DataTableTrigger
      v-if="hasData"
      @open="emit('open-table')"
    />
  </section>
</template>

<style scoped>
.chart-card {
  min-width: 0;
  padding: var(--space-5);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

.card-head {
  display: flex;
  gap: var(--space-4);
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: var(--space-3);

  .card-copy {
    min-width: 0;
  }
}

.card-title {
  margin: 0;
  font-size: var(--font-size-section);
}

.card-hint {
  margin: var(--space-1) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-dense);
}

.chart-head-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  justify-content: flex-end;
  align-items: center;
}

/* Every chart on this screen is the same height, so a row of two does not step. */
:slotted(.echarts-chart) {
  display: block;
  width: 100%;
  height: 270px;
  min-height: 270px;
}
</style>
