<script setup lang="ts">
/**
 * The map's key, and where the section says what stands where: each group its
 * drawing holds, in the group's word and colour, with how many.
 *
 * Hidden from assistive technology, which hears the same words and figures in the
 * map's caption.
 */
import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'

defineProps<{
  entries: readonly { count: number; label: string; state: ChainGroup }[]
}>()
</script>

<template>
  <div
    class="branch-key"
    aria-hidden="true"
  >
    <span
      v-for="entry in entries"
      :key="entry.state"
      class="branch-key-entry"
    >
      <SemanticState
        dimension="work-item-chain-group"
        :state="entry.state"
        :label="entry.label"
      />
      <span class="branch-key-count">{{ entry.count }}</span>
    </span>
  </div>
</template>

<style scoped>
.branch-key {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-4);
  align-items: center;
}

/* A group keeps its figure when the key wraps. */
.branch-key-entry {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
}

.branch-key-count {
  color: var(--color-text);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}
</style>
