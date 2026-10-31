<script setup lang="ts">
/**
 * What the field is showing, and how much of it.
 *
 * The two filter buttons carry their own counts, so the choice states its
 * consequence rather than making the operator switch to find out. The frontier
 * count on the right is the one number worth the accent: it is the work that could
 * start now.
 *
 * Scoped to a chain, the filter gives way to a chip naming the chain — the way
 * back to the whole space — and to a legend for the marker each node carries,
 * because a chain is read whole and has no open-only view to switch to.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  chain: { reference: string; total: number } | null
  hasEdges: boolean
  hiddenDone: number
  legend: readonly ChainGroup[]
  openTotal: number
  readyCount: number
  showDone: boolean
  showUnlinked: boolean
  unlinked: number
}>()

const emit = defineEmits<{
  'exit-chain': []
  'update:showDone': [value: boolean]
  'update:showUnlinked': [value: boolean]
}>()
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
    <button
      v-if="chain"
      class="graph-chip"
      type="button"
      :aria-label="t('graph.chainExit', { reference: chain.reference })"
      @click="emit('exit-chain')"
    >
      {{ t('graph.chainChip', { reference: chain.reference, count: chain.total }) }}
      <VIcon
        name="close"
        :size="14"
      />
    </button>
    <template v-else>
      <SegmentedControl
        class="graph-filter"
        size="compact"
        :label="t('graph.title')"
        :model-value="filter"
        :options="options"
        @update:model-value="updateFilter"
      />
      <ToggleSwitch
        v-if="unlinked"
        class="graph-unlinked"
        :label="t('graph.unlinkedToggle')"
        :model-value="showUnlinked"
        :on-label="t('graph.unlinked', { count: unlinked })"
        :off-label="t('graph.unlinked', { count: unlinked })"
        @update:model-value="(value) => emit('update:showUnlinked', value)"
      />
    </template>
    <div
      v-if="hasEdges || legend.length"
      class="graph-legend"
      aria-hidden="true"
    >
      <SemanticState
        v-for="group in legend"
        :key="group"
        dimension="work-item-chain-group"
        :state="group"
        :label="t(`workItem.chain.group.${group}`)"
      />
      <template v-if="hasEdges">
        <span class="graph-legend-item"><i class="stroke solid" />{{ t('graph.edgeBlocks') }}</span>
        <span class="graph-legend-item"
          ><i class="stroke dashed" />{{ t('graph.edgeDiscovered') }}</span
        >
      </template>
    </div>
    <span class="graph-frontier-count">{{ t('graph.frontier', { count: readyCount }) }}</span>
  </div>
</template>

<style scoped>
.graph-bar {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-5);
  align-items: center;
  padding: var(--space-1) 0 var(--space-3);
}

/* The chain the field is scoped to, and the way back out of it. */
.graph-chip {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: var(--size-control-height-compact);
  padding: 0 var(--space-3);
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-chip);
  font-variant-numeric: tabular-nums;
  background: var(--color-surface-muted);
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    color: var(--color-text);
    background: var(--color-control-surface);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

.graph-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-4);
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
    gap: var(--space-2);
  }

  .graph-legend {
    flex-basis: 100%;
    order: 3;
  }
}
</style>
