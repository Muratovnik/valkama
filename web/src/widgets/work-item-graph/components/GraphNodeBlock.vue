<script setup lang="ts">
/**
 * A card zoomed out past reading: a block of its state's colour — the key's
 * dot, grown to the card — with its reference on it. A chain view colours it
 * by progress, as the card's branch map does, at a zoom where nothing else on
 * the card survives. The root is framed in the text colour, so it is found
 * without its word.
 */
import { computed } from 'vue'

import type { LiveWork } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import type { SemanticStatePair } from '@/shared/lib/uiSystem.ts'

const {
  markerState,
  reference,
  chainGroup,
  live = null,
  root = false,
  still = false,
} = defineProps<{
  /** The card's marker, which colours the block outside a chain. */
  markerState: Extract<SemanticStatePair, { dimension: 'work-item-node-marker' }>['state']
  reference: string
  /** Where the card stands in the chain the field is scoped to, which colours it there. */
  chainGroup?: ChainGroup
  /** Live work on the card, which the block says with the working dots after its reference. */
  live?: LiveWork | null
  root?: boolean
  /** The field does not move: the dots hold still. */
  still?: boolean
}>()

/** Only a turn running moves, and only while the field's motion runs. */
const resting = computed(() => still || live?.state !== 'working')
</script>

<template>
  <span class="flow-node-overview">
    <i
      v-if="chainGroup"
      class="flow-node-dot"
      :class="{ root }"
      :data-tone="statePresentation('work-item-chain-group', chainGroup).tone"
    />
    <i
      v-else
      class="flow-node-dot"
      :class="{ root }"
      :data-tone="statePresentation('work-item-node-marker', markerState).tone"
    />
    <span class="flow-node-overview-reference"
      >{{ reference
      }}<span
        v-if="live"
        class="work-dots flow-node-overview-live"
        aria-hidden="true"
        :class="{ still: resting }"
        ><i /><i /><i /></span
    ></span>
  </span>
</template>

<style scoped>
.flow-node-overview {
  display: contents;
}

.flow-node-dot {
  position: absolute;
  inset: 0;
  background: var(--color-text-tertiary);
  border-radius: var(--radius-status);

  &.root {
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

/* After the reference, grown with it. */
.flow-node-overview-live {
  margin-inline-start: var(--space-1);
}
</style>
