<script setup lang="ts">
/** The card owns claim/state presentation; Vue Flow owns exactly-once activation. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Handle, Position } from '@vue-flow/core'

import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import { holderName } from '@/shared/lib/actor.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import type { SemanticStatePair } from '@/shared/lib/uiSystem.ts'

const {
  node,
  ready,
  chainGroup,
  marked = false,
  overview = false,
  root = false,
  tabbable = false,
} = defineProps<{
  node: PlacedNode
  ready: boolean
  recessed: boolean
  /** Where the node stands in the chain the field is scoped to, marked on its edge. */
  chainGroup?: ChainGroup
  /** In the branch of the chain the card chose, which the field frames and lights. */
  marked?: boolean
  /** The field is zoomed out past reading: the card is its state's colour and its reference. */
  overview?: boolean
  parentReference?: string
  /** The item the chain the field is scoped to grew from. */
  root?: boolean
  /** The field's one Tab stop; the arrows reach every other node. */
  tabbable?: boolean
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

/** The field's one Tab stop takes Tab; the arrows reach the rest. */
const tabIndex = computed(() => (tabbable ? 0 : -1))

/** What a reader hears for the card: the same facts it shows, the root's mark included. */
const accessibleName = computed(() =>
  [
    `${node.reference} ${node.title}`,
    node.state.name,
    ...(root ? [t('graph.rootLabel')] : []),
  ].join(' · '),
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
      root,
      overview,
      marked,
    }"
    :aria-label="accessibleName"
    :tabindex="tabIndex"
    @focus="emit('focus', node.work_item_id)"
    @blur="emit('blur', node.work_item_id)"
  >
    <span
      v-if="overview"
      class="flow-node-overview"
    >
      <i
        v-if="chainGroup"
        class="flow-node-dot"
        :data-tone="statePresentation('work-item-chain-group', chainGroup).tone"
      />
      <i
        v-else
        class="flow-node-dot"
        :data-tone="statePresentation('work-item-node-marker', markerState).tone"
      />
      <span class="flow-node-overview-reference">{{ node.reference }}</span>
    </span>
    <template v-else>
      <span
        v-if="chainGroup"
        class="flow-node-chain"
        aria-hidden="true"
        :data-tone="statePresentation('work-item-chain-group', chainGroup).tone"
      />
      <span class="flow-node-line">
        <span class="flow-node-meta">
          <span class="flow-node-id">{{ node.reference }}</span>
          <span
            v-if="root"
            class="flow-node-root"
            >{{ t('graph.rootMark') }}</span
          >
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
        <span class="flow-node-owner-name">{{ holderName(node.claim_ref) }}</span>
      </span>
    </template>
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

  /* The root is what the rest of the chain grew from, so it stands one step
     above the members whatever its state: closed, it would otherwise sink into
     the ground with the closed work around it. */
  &.root {
    background: var(--color-surface-sheet);
  }

  /* A member of the branch the card chose: its edge takes the selection
     accent, so the branch stands out of the field whatever else is lit; the
     parent chip on each card names the branch in words. */
  &.marked {
    border-color: var(--color-accent);
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

/* The chain marker is a fill on the card's leading edge rather than a border:
   the card's outline stays the one line it draws. */
.flow-node-chain {
  position: absolute;
  inset-block: var(--space-2);
  inset-inline-start: 0;
  width: 3px;
  background: var(--color-text-tertiary);
  border-radius: var(--radius-status);

  &[data-tone='success'] {
    background: var(--color-success);
  }

  &[data-tone='warning'] {
    background: var(--color-warning);
  }

  &[data-tone='info'] {
    background: var(--color-info);
  }

  &[data-tone='danger'] {
    background: var(--color-danger);
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

/* The root's mark: a word, so it reads without the colour, on the fill the
   parent chip uses, in the full text tone so it outranks that chip. */
.flow-node-root {
  flex: 0 0 auto;
  padding: var(--space-hair) var(--space-1);
  color: var(--color-text);
  font-weight: 600;
  white-space: nowrap;
  background: var(--color-control-surface);
  border-radius: var(--radius-status);
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

/* The overview: a card too small to read becomes a block of its state's colour
   — the key's dot, grown to the card — with its reference on it. This is a
   chain view's colour by progress, as on the card's branch map, at a zoom where
   nothing else on the card survives. Finished work keeps its colour, quieter,
   as the ground the open work stands on; the root is framed in the text colour,
   so it is found without its word. */
.flow-node-card.overview {
  display: flex;
  align-items: center;
  padding: 0 var(--space-6);
  border-color: transparent;

  &.marked {
    border-color: var(--color-accent);
  }

  &.recessed {
    opacity: 0.55;
  }

  &.root {
    background: var(--color-text);
  }
}

.flow-node-overview {
  display: contents;
}

.flow-node-dot {
  position: absolute;
  inset: 0;
  background: var(--color-text-tertiary);
  border-radius: var(--radius-status);

  .flow-node-card.root & {
    inset: var(--space-2);
  }

  &[data-tone='success'] {
    background: var(--color-success);
  }

  &[data-tone='warning'] {
    background: var(--color-warning);
  }

  &[data-tone='info'] {
    background: var(--color-info);
  }

  &[data-tone='danger'] {
    background: var(--color-danger);
  }
}

/* Drawn in the field's own space, which the camera scales down: the type ramp's
   largest step, scaled with the drawing rather than set off the ramp. */
.flow-node-overview-reference {
  position: relative;
  color: var(--color-text-on-action);
  font: var(--font-drawer-title);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transform: scale(2.2);
  transform-origin: left center;
}

@media (prefers-reduced-motion: reduce) {
  .flow-node-card {
    transition: none;
  }
}
</style>
