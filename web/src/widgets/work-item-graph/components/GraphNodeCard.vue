<script setup lang="ts">
/** The card owns claim/state presentation; Vue Flow owns exactly-once activation. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Handle, Position } from '@vue-flow/core'

import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import { actorName } from '@/shared/lib/actor.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import type { SemanticStatePair } from '@/shared/lib/uiSystem.ts'

const { node, ready } = defineProps<{
  node: PlacedNode
  ready: boolean
  recessed: boolean
  parentReference?: string
}>()
const emit = defineEmits<{ blur: [id: string]; focus: [id: string] }>()
const { t } = useI18n()

type WorkItemNodeMarkerState = Extract<
  SemanticStatePair,
  { dimension: 'work-item-node-marker' }
>['state']

/**
 * The marker answers the next operational question in priority order: an item
 * ready to start outranks ownership, ownership outranks its resting workflow
 * category, and the shared UI system owns the resulting tone.
 */
const markerState = computed<WorkItemNodeMarkerState>(() => {
  if (ready) return 'ready'
  if (node.claim_ref && !node.state.is_terminal) return 'claimed'
  return node.state.category
})

/**
 * What the node says about itself in one word.
 *
 * A workable item announces that first: its state is the less useful half of
 * the sentence once the field has told you it can be picked up.
 */
const stateLabel = computed(() => (ready ? t('graph.readyMark') : node.state.name))
const ownerLabel = computed(() =>
  t(node.state.is_terminal ? 'workItem.previousOwner' : 'graph.claimedBy'),
)
</script>

<template>
  <Handle
    id="target"
    class="graph-handle"
    type="target"
    :position="Position.Left"
    :connectable="false"
  />
  <Handle
    id="source"
    class="graph-handle"
    type="source"
    :position="Position.Right"
    :connectable="false"
  />
  <button
    class="flow-node-card nopan"
    type="button"
    :data-tone="statePresentation('work-item-node-marker', markerState).tone"
    :class="{
      ready,
      'is-terminal': node.state.is_terminal,
      recessed,
    }"
    :aria-label="`${node.reference} ${node.title} · ${node.state.name}`"
    @focus="emit('focus', node.work_item_id)"
    @blur="emit('blur', node.work_item_id)"
  >
    <span class="flow-node-line">
      <span class="flow-node-meta">
        <span class="flow-node-id">{{ node.reference }}</span>
        <span class="flow-node-state">{{ stateLabel }}</span>
      </span>
      <span
        v-if="parentReference"
        class="flow-node-epic"
        :title="`${t('workItem.parent')} ${parentReference}`"
        >{{ parentReference }}</span
      >
    </span>
    <span
      class="flow-node-title"
      :title="node.title"
      >{{ node.title }}</span
    >
    <span
      v-if="node.claim_ref"
      class="flow-node-owner"
    >
      <span class="flow-node-owner-state">{{ ownerLabel }}</span>
      <span class="flow-node-owner-name">{{ actorName(node.claim_ref) }}</span>
    </span>
  </button>
</template>

<style scoped>
.graph-handle {
  opacity: 0;
  pointer-events: none;
}

.flow-node-card {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-content: stretch;
  width: 100%;
  height: 100%;
  padding: var(--space-3);
  border: 1px solid var(--color-rule);
  color: var(--color-text);
  text-align: left;
  background: color-mix(in srgb, var(--color-surface-sheet) 92%, var(--color-surface-recess));
  border-radius: var(--radius-status);
  transition: background-color var(--duration-quick) var(--ease-out);
  cursor: pointer;

  &.is-terminal {
    background: var(--color-surface-recess);
  }

  &.recessed {
    background: var(--color-surface-recess);
  }

  &:hover {
    background: var(--color-surface-hover);
  }

  /* Keyboard focus is not a hover: the ring says where the keyboard is, and a
     background step alone cannot, because every pointed-at node shows the same
     step. */
  &:focus-visible {
    background: var(--color-surface-hover);
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }
}

.flow-node-line {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.flow-node-meta {
  display: flex;
  gap: var(--space-1) var(--space-2);
  align-items: baseline;
  min-width: 0;
  overflow: hidden;
}

:is(.flow-node-id, .flow-node-state) {
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  /* Workable is the one state worth a weight change: it says work could start. */
  .flow-node-card.ready & {
    color: var(--color-action-primary);
    font-weight: 700;
  }
}

.flow-node-id {
  font-variant-numeric: tabular-nums;
}

.flow-node-card[data-tone='danger']:not(.ready) .flow-node-state {
  color: var(--color-danger);
}

.flow-node-card.recessed .flow-node-title {
  color: var(--color-text-muted);
}

.flow-node-owner {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  align-self: stretch;
  min-width: 0;
  max-width: 100%;
  min-height: 16px;
  color: var(--color-text-muted);
  font: var(--font-line);
  overflow: hidden;
}

.flow-node-owner-state {
  flex: 0 0 auto;
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.flow-node-owner-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.flow-node-epic {
  min-width: 0;
  max-width: 80px;
  padding: var(--space-hair) var(--space-1);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  background: var(--color-control-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  border-radius: var(--radius-status);
}

.flow-node-title {
  display: -webkit-box;
  align-self: center;
  font: var(--font-row-title);
  overflow-wrap: anywhere;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

@media (prefers-reduced-motion: reduce) {
  .flow-node-card {
    transition: none;
  }
}
</style>
