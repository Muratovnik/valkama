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
 * back to the whole space. The chip counts the whole chain; the field draws its
 * open part, and a switch beside the chip says how many closed members that
 * leaves out and draws them. The key to the markers lies on the field itself
 * (`GraphLegend`), so this bar stays one row and never changes height with it.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import ScopeChip from '@/shared/ui/ScopeChip.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import ToggleSwitch from '@/shared/ui/ToggleSwitch.vue'

const props = defineProps<{
  chain: { reference: string; total: number } | null
  hiddenDone: number
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
    <ScopeChip
      v-if="chain"
      class="graph-chip"
      :label="t('graph.chainChip', { reference: chain.reference, count: chain.total })"
      :exit-label="t('graph.chainExit', { reference: chain.reference })"
      @exit="emit('exit-chain')"
    />
    <ToggleSwitch
      v-if="chain && hiddenDone"
      class="graph-closed"
      :label="t('graph.closedToggle')"
      :model-value="showDone"
      :on-label="t('graph.closed', { count: hiddenDone })"
      :off-label="t('graph.closed', { count: hiddenDone })"
      @update:model-value="(value) => emit('update:showDone', value)"
    />
    <template v-if="!chain">
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

.graph-frontier-count {
  margin-left: auto;
  color: var(--color-action-primary);
  font: var(--font-line);
}

@container workspace (width <= 586px) {
  .graph-bar {
    gap: var(--space-2);
  }
}
</style>
