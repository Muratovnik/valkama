<script setup lang="ts">
/**
 * A frame header's first line, as a card's is: what it is and its reference, its
 * state once it has moved, and at the far end the work moving under it. The state
 * gives way first when the line is full, then the reference; the header's button
 * keeps both whole in its name. Over the work under no epic the line is its name.
 * Zoomed out it is the reference alone, grown with the field by the `--grow` the
 * header sets, and far out it gives way to what a fold hides (`named`).
 */
import { computed } from 'vue'

import GraphFrameWorking from '@/widgets/work-item-graph/components/GraphFrameWorking.vue'

import { printsFacet } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const {
  epic,
  named = true,
  overview = false,
} = defineProps<{
  /** The epic the header opens; the work under no epic has none. */
  epic: WorkItemBrief | null
  /** What the work under no epic is called. */
  title: string
  /** How many items under the frame an agent is working on now. */
  working: number
  /** Whether the reference or the name is drawn. */
  named?: boolean
  overview?: boolean
  /** The field's motion does not run, so the working dots hold still. */
  still?: boolean
}>()

/** An epic says it is one; an item that grew children says it is an item. */
const kindGlyph = computed(() => (epic?.kind === 'epic' ? 'kind-epic' : 'parent'))
const kindInk = computed(() => (epic?.kind === 'epic' ? 'epic' : undefined))
/** The epic's state, said once it has moved, as a board's lane says it. */
const stateShown = computed(() => (epic ? printsFacet('state', 'lane', epic) : false))
</script>

<template>
  <span
    class="graph-frame-line"
    :class="{ overview }"
  >
    <VIcon
      v-if="epic && !overview"
      class="graph-frame-kind"
      :data-kind="kindInk"
      :name="kindGlyph"
      :size="14"
    />
    <template v-if="named">
      <span
        v-if="epic"
        class="graph-frame-reference"
        :title="epic.reference"
        >{{ epic.reference }}</span
      >
      <span
        v-else
        class="graph-frame-title"
        >{{ title }}</span
      >
    </template>
    <SemanticState
      v-if="epic && stateShown && !overview"
      class="graph-frame-state"
      dimension="work-item-state"
      :class="{ closed: epic.state.is_terminal }"
      :state="epic.state.category"
      :label="epic.state.name"
    />
    <GraphFrameWorking
      v-if="working"
      :count="working"
      :overview="overview"
      :still="still"
    />
  </span>
</template>

<style scoped>
.graph-frame-line {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  font: var(--font-detail);

  &.overview {
    align-items: flex-start;
  }
}

.graph-frame-kind {
  flex: 0 0 auto;
  color: var(--color-kind-ink, currentcolor);
}

.graph-frame-reference {
  flex: 0 1 auto;
  min-width: 0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.graph-frame-title {
  min-width: 0;
  color: var(--color-text);
  font: var(--font-row-title);
}

/* A closed epic still holding open work says so, quietly. */
.graph-frame-state {
  flex: 0 1000 auto;
  min-width: 0;
  min-height: 0;
  margin-inline-start: var(--space-1);

  &.closed {
    opacity: 0.7;
  }
}

.overview :is(.graph-frame-reference, .graph-frame-title) {
  display: block;
  flex: 0 0 auto;
  max-width: calc(100% / var(--grow));
  height: calc(1lh * var(--grow));
  color: var(--color-text);
  font: var(--font-drawer-title);
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transform: scale(var(--grow));
  transform-origin: left top;
}
</style>
