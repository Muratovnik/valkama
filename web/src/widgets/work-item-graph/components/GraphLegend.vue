<script setup lang="ts">
/**
 * The key to the field: which place in the chain each marker colour is, and
 * which line is a block and which only context.
 *
 * It lies on the field's corner rather than in the bar above it. In the bar it
 * shared one row with the chip, the switch and the frontier count, and at any
 * width under a wide monitor it wrapped — and wrapped again when the closed
 * members brought «Done» into it, pushing the whole field down under the
 * operator's pointer. It stands in the strip above the flow, so no node is
 * ever drawn under it.
 *
 * It names only what the field draws. «Done» is the one entry the closed switch
 * adds, so while the chain has closed members its place is kept, unseen, before
 * the others: the switch never moves a word of the key.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'

const props = defineProps<{
  /** The chain groups the field draws. */
  groups: readonly ChainGroup[]
  hasEdges: boolean
  /** The chain has closed members, so «Done» may come and go: its place is kept. */
  keepDone: boolean
}>()
const { t } = useI18n()

/** Done leads, as on the card's map: what is finished, then what is under way, then ahead. */
const entries = computed(() => {
  const shown = new Set(props.groups)
  const open = props.groups.filter((group) => group !== 'done')
  const done =
    shown.has('done') || props.keepDone
      ? [{ group: 'done' as const, shown: shown.has('done') }]
      : []
  return [...done, ...open.map((group) => ({ group, shown: true }))]
})
</script>

<template>
  <div
    v-if="entries.length || hasEdges"
    class="graph-legend"
    aria-hidden="true"
  >
    <SemanticState
      v-for="entry in entries"
      :key="entry.group"
      class="graph-legend-state"
      dimension="work-item-chain-group"
      :class="{ held: !entry.shown }"
      :state="entry.group"
      :label="t(`workItem.chain.group.${entry.group}`)"
    />
    <template v-if="hasEdges">
      <span class="graph-legend-item"><i class="stroke solid" />{{ t('graph.edgeBlocks') }}</span>
      <span class="graph-legend-item"
        ><i class="stroke dashed" />{{ t('graph.edgeDiscovered') }}</span
      >
    </template>
  </div>
</template>

<style scoped>
.graph-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-4);
  justify-content: flex-end;
  align-items: center;
  padding: 0 var(--space-3);
  color: var(--color-text-muted);
  font: var(--font-count);
  background: var(--color-surface-recess);
  border-radius: var(--radius-status);
}

/* Kept, not drawn: the place «Done» takes when the closed members are shown. */
.graph-legend-state.held {
  visibility: hidden;
}

.graph-legend-item {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-height: 24px;
  white-space: nowrap;
}

.stroke {
  width: 18px;
  border-top: 2px solid var(--color-graph-line);

  &.dashed {
    border-top-style: dashed;
  }
}
</style>
