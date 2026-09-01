<script setup lang="ts">
/**
 * What the field is showing, and how much of it.
 *
 * The two filter buttons carry their own counts, so the choice states its
 * consequence rather than making the operator switch to find out. The frontier
 * count on the right is the one number worth the accent: it is the work that could
 * start now.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

const props = defineProps<{
  hasEdges: boolean
  hiddenDone: number
  openTotal: number
  readyCount: number
  showDone: boolean
}>()

const emit = defineEmits<{ 'update:showDone': [value: boolean] }>()
const { t } = useI18n()
const filter = computed(() => (props.showDone ? 'all' : 'open'))
const options = computed(() => [
  { value: 'open' as const, label: t('graph.openOnly', { count: props.openTotal }) },
  {
    value: 'all' as const,
    label: t('graph.all', { count: props.openTotal + props.hiddenDone }),
  },
])

function updateFilter(value: 'all' | 'open') {
  emit('update:showDone', value === 'all')
}
</script>

<template>
  <div class="graph-bar">
    <SegmentedControl
      class="graph-filter"
      size="compact"
      :label="t('graph.title')"
      :model-value="filter"
      :options="options"
      @update:model-value="updateFilter"
    />
    <div
      v-if="hasEdges"
      class="graph-legend"
      aria-hidden="true"
    >
      <span class="graph-legend-item"><i class="stroke solid" />{{ t('graph.edgeBlocks') }}</span>
      <span class="graph-legend-item"
        ><i class="stroke dashed" />{{ t('graph.edgeDiscovered') }}</span
      >
    </div>
    <span class="graph-frontier-count">{{ t('graph.frontier', { count: readyCount }) }}</span>
  </div>
</template>

<style scoped>
.graph-bar {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-5);
  align-items: center;
  padding: var(--space-1) var(--space-5) var(--space-3);
}

.graph-legend {
  display: flex;
  gap: var(--space-4);
  color: var(--color-text-muted);
  font: var(--font-count);
}

.graph-legend-item {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
}

.stroke {
  width: 18px;
  border-top: 2px solid var(--color-graph-line);

  &.dashed {
    border-top-style: dashed;
  }
}

.graph-frontier-count {
  margin-left: auto;
  color: var(--color-action-primary);
  font: var(--font-line);
}

@container workspace (width <= 586px) {
  .graph-bar {
    flex-wrap: wrap;
    gap: var(--space-2);
    padding-inline: var(--space-3);
  }

  .graph-legend {
    flex-basis: 100%;
    order: 3;
  }
}
</style>
