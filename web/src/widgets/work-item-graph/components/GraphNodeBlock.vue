<script setup lang="ts">
/**
 * A card zoomed out past reading: a block of its state's colour — the key's
 * dot, grown to the card — with its reference on it. A chain view colours it
 * by progress, as the card's branch map does, at a zoom where nothing else on
 * the card survives. The root is framed in the text colour, so it is found
 * without its word. It carries no sign of what an agent is doing: a session's sign
 * with no word beside it says little on a block already filled with a colour.
 * That stays on the lines' comets and the frame's count, and in the card's name
 * and tooltip.
 *
 * The reference is grown to read at this zoom, and held to what the block has room
 * for, so a long one stands whole at a smaller size rather than running off the edge.
 */
import { onMounted, ref, useTemplateRef, watch } from 'vue'

import { NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'

import type { ChainGroup } from '@/shared/api/planningChainGroups.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import type { SemanticStatePair } from '@/shared/lib/uiSystem.ts'

const {
  markerState,
  reference,
  chainGroup,
  root = false,
} = defineProps<{
  /** The card's marker, which colours the block outside a chain. */
  markerState: Extract<SemanticStatePair, { dimension: 'work-item-node-marker' }>['state']
  reference: string
  /** Where the card stands in the chain the field is scoped to, which colours it there. */
  chainGroup?: ChainGroup
  root?: boolean
}>()

/** What the card's padding in the overview leaves of its width (`GraphNodeCard`). */
const REFERENCE_ROOM = NODE_WIDTH - 48
const REFERENCE_LARGEST = 2.2

const label = useTemplateRef<HTMLElement>('reference-label')
const scale = ref(REFERENCE_LARGEST)

/** A transform leaves the layout's width as it was, so this reads the unscaled text. */
function fitReference() {
  const width = label.value?.offsetWidth ?? 0
  scale.value = width > 0 ? Math.min(REFERENCE_LARGEST, REFERENCE_ROOM / width) : REFERENCE_LARGEST
}

onMounted(fitReference)
watch(() => reference, fitReference, { flush: 'post' })
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
    <span
      ref="reference-label"
      class="flow-node-overview-reference"
      :style="{ '--overview-reference-scale': scale }"
      >{{ reference }}</span
    >
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
  --overview-reference-scale: 2.2;

  position: relative;
  color: var(--color-text-on-action);
  font: var(--font-drawer-title);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  transform: scale(var(--overview-reference-scale));
  transform-origin: left center;
}
</style>
