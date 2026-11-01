<script setup lang="ts">
/**
 * What lies on the field's corner: the key, or in a phone-wide workspace the
 * frontier count.
 *
 * Narrow, the bar has no room for the count and opens the key under its
 * options button instead, so the count takes the key's corner and stays in
 * sight. Either way it stands in the strip above the flow, so no node is ever
 * drawn under it.
 */
import { useI18n } from 'vue-i18n'

import GraphLegend from '@/widgets/work-item-graph/components/GraphLegend.vue'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'

defineProps<{
  groups: readonly ChainGroup[]
  hasEdges: boolean
  keepDone: boolean
  /** The one state a group's members share, which the key says in the group's place. */
  names: Readonly<Record<ChainGroup, string | null>>
  readyCount: number
}>()
const { t } = useI18n()
</script>

<template>
  <span class="graph-frontier-on-field">{{ t('graph.frontier', { count: readyCount }) }}</span>
  <GraphLegend
    class="graph-legend-on-field"
    :groups="groups"
    :names="names"
    :has-edges="hasEdges"
    :keep-done="keepDone"
  />
</template>

<style scoped>
.graph-frontier-on-field {
  display: none;
}

@container workspace (width <= 586px) {
  .graph-legend-on-field {
    display: none;
  }

  .graph-frontier-on-field {
    display: block;
    padding: 0 var(--space-2);
    color: var(--color-action-primary);
    font: var(--font-line);
    background: var(--color-surface-recess);
    border-radius: var(--radius-status);
  }
}
</style>
