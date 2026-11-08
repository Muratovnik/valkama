<script setup lang="ts">
/**
 * The card owns claim/state presentation; Vue Flow owns exactly-once activation.
 * Its facets are the registry's: workable is said quietly in the state's place
 * (it was the boldest ink on half the cards), a node an open blocker holds
 * names it wherever it lives, and the glyphs are read, not pressed — the card
 * is one button, and a control inside a button is no control at all.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Handle, Position } from '@vue-flow/core'

import GraphLiveMark from '@/widgets/work-item-graph/components/GraphLiveMark.vue'
import GraphNodeBlock from '@/widgets/work-item-graph/components/GraphNodeBlock.vue'
import { useLiveWord } from '@/widgets/work-item-graph/composables/useGraphMotion.ts'
import type { LiveWork, PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import FacetMarks from '@/entities/work-item/components/FacetMarks.vue'
import { holderRef } from '@/entities/work-item/utils/facets.ts'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import { holderName } from '@/shared/lib/actor.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import type { SemanticStatePair } from '@/shared/lib/uiSystem.ts'
import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'

const {
  node,
  ready,
  chainGroup,
  framed = false,
  live = null,
  marked = false,
  overview = false,
  root = false,
  still = false,
  tabbable = false,
  waitingOn = null,
} = defineProps<{
  node: PlacedNode
  ready: boolean
  recessed: boolean
  /** Where the node stands in the chain the field is scoped to, marked on its edge. */
  chainGroup?: ChainGroup
  /** It stands in a frame, a step above the frame's ground as the frame is above the field's. */
  framed?: boolean
  /** What an agent's session behind it is doing now; none when no session is live. */
  live?: LiveWork | null
  /** In the branch of the chain the card chose, which the field frames and lights. */
  marked?: boolean
  /** The field is zoomed out past reading: the card is its state's colour and its reference. */
  overview?: boolean
  parentReference?: string
  /** The item the chain the field is scoped to grew from. */
  root?: boolean
  /** The field's motion does not run, so live work holds still. */
  still?: boolean
  /** The field's one Tab stop; the arrows reach every other node. */
  tabbable?: boolean
  /** The reference of an open item that blocks this one, wherever it lives. */
  waitingOn?: string | null
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

/** What the registry needs beyond the node: what it waits on. */
const facetContext = computed(() => ({ waitingOn }))

/** Workable or waiting, said in words, or nothing when it is neither. */
const readinessLabel = computed(() => {
  if (node.state.is_terminal) return null
  if (waitingOn) return t('workItem.facet.waiting', { reference: waitingOn })
  return ready ? t('workItem.facet.ready') : null
})
const ownerLabel = computed(() =>
  t(node.state.is_terminal ? 'workItem.previousOwner' : 'graph.claimedBy'),
)
/**
 * Who the foot names: the claim on open work, and on finished work whoever
 * held it when it closed, since a close ends the claim.
 */
const holder = computed(() => holderRef(node))

/**
 * The head reads as every surface reads an item: the kind, the reference, high or
 * urgent, then the state or what stands in its place, which gives way first when
 * the line is full. High and urgent used to wait at the card's foot, the one
 * surface that put the priority after the holder.
 */
const HEAD = ['kind', 'priority'] as const
const STATE = ['state', 'readiness'] as const

/** The field's one Tab stop takes Tab; the arrows reach the rest. */
const tabIndex = computed(() => (tabbable ? 0 : -1))

const liveWord = useLiveWord()

/** What a reader hears for the card: the same facts it shows, the root's mark and live work included. */
const accessibleName = computed(() =>
  [
    `${node.reference} ${node.title}`,
    node.state.name,
    ...(readinessLabel.value ? [readinessLabel.value] : []),
    ...(holder.value ? [`${ownerLabel.value} ${holderName(holder.value)}`] : []),
    ...(live ? [liveWord(live)] : []),
    ...(root ? [t('graph.rootLabel')] : []),
  ].join(' · '),
)

/** A block has no words of its own, so its tooltip says what the card would. */
const blockTitle = computed(() => (overview ? accessibleName.value : undefined))
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
    v-tooltip="blockTitle"
    class="flow-node-card nopan"
    type="button"
    :data-tone="statePresentation('work-item-node-marker', markerState).tone"
    :class="{
      ready,
      framed,
      'is-terminal': node.state.is_terminal,
      recessed,
      root,
      overview,
      marked,
    }"
    :aria-label="accessibleName"
    :data-walk-target="node.work_item_id"
    :tabindex="tabIndex"
    @focus="emit('focus', node.work_item_id)"
    @blur="emit('blur', node.work_item_id)"
  >
    <GraphNodeBlock
      v-if="overview"
      :reference="node.reference"
      :marker-state="markerState"
      :chain-group="chainGroup"
      :root="root"
    />
    <template v-else>
      <span
        v-if="chainGroup"
        class="flow-node-chain"
        aria-hidden="true"
        :data-tone="statePresentation('work-item-chain-group', chainGroup).tone"
      />
      <span class="flow-node-line">
        <span class="flow-node-meta">
          <FacetMarks
            class="flow-node-head"
            surface="graph"
            :item="node"
            :facets="HEAD"
          >
            <span class="flow-node-id">{{ node.reference }}</span>
            <span
              v-if="root"
              class="flow-node-root"
              >{{ t('graph.rootMark') }}</span
            >
          </FacetMarks>
          <FacetMarks
            class="flow-node-state"
            surface="graph"
            :item="node"
            :facets="STATE"
            :context="facetContext"
          />
        </span>
        <span
          v-if="parentReference"
          v-tooltip="`${t('workItem.parent')} ${parentReference}`"
          class="flow-node-epic"
          >{{ parentReference }}</span
        >
      </span>
      <span
        v-slash-breaks="node.title"
        v-tooltip.clipped="node.title"
        class="flow-node-title"
      />
      <span
        v-if="holder || live"
        class="flow-node-owner"
      >
        <template v-if="holder">
          <span
            v-if="!live"
            class="flow-node-owner-state"
            >{{ ownerLabel }}</span
          >
          <span class="flow-node-owner-name">{{ holderName(holder) }}</span>
        </template>
        <GraphLiveMark
          v-if="live"
          :live="live"
          :still="still"
        />
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

  /* Receding and coming back are eased, so a pointer or the keyboard moving
     from one lineage to the next fades one into the other. */
  transition:
    background-color var(--duration-quick) var(--ease-out),
    opacity var(--duration-quick) var(--ease-out);
  cursor: pointer;

  &.framed {
    background: var(--color-surface-sheet);
  }

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
    outline: var(--size-focus-ring) solid var(--color-focus-ring);
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
  align-items: center;
  min-width: 0;
  overflow: hidden;
}

/* The kind, the reference and high or urgent keep their room; the state gives way. */
.flow-node-head {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  column-gap: var(--space-2);
}

.flow-node-id {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* The state, or what stands in its place, gives way first when the line is full. */
.flow-node-state {
  overflow: hidden;
}

.flow-node-card.recessed .flow-node-title {
  color: var(--color-text-muted);
}

/* Who holds it. Beside live work the row drops «Claimed by»: the live word already
   says a session is at the item, and the word and the name have one line of a card
   between them. Only the name gives way, so whatever the words, some of it stays;
   the accessible name keeps the label and the whole name. */
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

/* The holder's name gives way to the live word beside it; the card's
   accessible name keeps it whole. */
.flow-node-owner-name {
  flex: 1 1 auto;
  min-width: 0;
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
  transition: color var(--duration-quick) var(--ease-out);
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

@media (prefers-reduced-motion: reduce) {
  .flow-node-card,
  .flow-node-title {
    transition: none;
  }
}
</style>
