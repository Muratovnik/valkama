<script setup lang="ts">
/**
 * One work item on the field, and the four states it can be in.
 *
 * The state used to be five classes on Vue Flow's node wrapper, with nine rules
 * reaching back down through `:deep()` to colour a dot inside this card. The card
 * derives what it can from the node it was handed — claimed, which state — and
 * takes `ready`, `recessed` and the parent's reference as props, because each is
 * a fact about the whole field rather than about this item.
 *
 * The shared marker presentation owns priority too: ready outranks an active
 * claim, and an active claim outranks the state's category. A resting marker
 * still uses category rather than name, so renaming a lane cannot lose its
 * meaning and a second blocked state does not need another local selector.
 *
 * The button does not emit open. Vue Flow emits one `nodeClick` for it, and that
 * is what keeps mouse and keyboard activation exactly-once.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

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

/** An executor is at work while the state is one somebody works inside. */
const inFlight = computed(
  () => node.state.category === 'active' || node.state.category === 'review',
)
</script>

<template>
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
      <template v-if="inFlight">
        <span
          class="work-dots"
          aria-hidden="true"
          ><i /><i /><i
        /></span>
        <span class="flow-node-owner-state">{{ t('work.active') }}</span>
      </template>
      <span class="flow-node-owner-name">{{ actorName(node.claim_ref) }}</span>
    </span>
  </button>
</template>

<style scoped>
.flow-node-card {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: var(--space-2);
  align-content: stretch;
  width: 100%;
  height: 100%;
  padding: var(--space-3) var(--space-3) var(--space-3) var(--space-6);
  color: var(--color-text);
  text-align: left;
  background: color-mix(in srgb, var(--color-surface-sheet) 92%, var(--color-surface-recess));
  border-radius: var(--radius-status);
  transition:
    opacity var(--duration-quick) var(--ease-out),
    background-color var(--duration-quick) var(--ease-out);
  cursor: pointer;

  /* The state dot, at the left edge of the card. */
  &::before {
    content: '';
    position: absolute;
    inset: 11px auto auto 8px;
    width: 7px;
    height: 7px;
    background: var(--color-rule);
    border-radius: 50%;
  }

  /* Workable outranks both: it is the one state that tells a reader to act. */
  &.ready::before {
    background: var(--color-action-primary);
  }

  &.is-terminal {
    opacity: 0.55;
  }

  &.recessed {
    opacity: 0.3;
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

/* The canonical marker presentation supplies status tones. Workable keeps the
   action accent above them because it is the one state that asks for action. */
.flow-node-card[data-tone='success']:not(.ready)::before {
  background: var(--color-success);
}

.flow-node-card[data-tone='danger']:not(.ready)::before {
  background: var(--color-danger);
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
  gap: var(--space-2);
  align-items: baseline;
  min-width: 0;
  overflow: hidden;
}

:is(.flow-node-id, .flow-node-state) {
  flex: 0 0 auto;

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

.flow-node-card.is-terminal .flow-node-title {
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
  color: var(--color-success);
  font: var(--font-line);
  overflow: hidden;
}

.flow-node-owner-state {
  flex: 0 0 auto;
  max-width: 72px;
  font-weight: 700;
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
  flex: 0 0 auto;
  padding: var(--space-hair) var(--space-1);
  font-variant-numeric: tabular-nums;
  background: var(--color-control-surface);
  border-radius: var(--radius-status);
}

.flow-node-title {
  align-self: center;
  font: var(--font-detail);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (prefers-reduced-motion: reduce) {
  .flow-node-card {
    transition: none;
  }
}
</style>
