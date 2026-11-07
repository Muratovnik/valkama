<script setup lang="ts">
import { Background } from '@vue-flow/background'
import { PanOnScrollMode, VueFlow } from '@vue-flow/core'
import type { Edge as FlowEdge, Node as FlowNode } from '@vue-flow/core'

/**
 * The flow itself: Vue Flow, held to a field that is read and never edited, and
 * the look of what the library renders round the field's own drawings.
 *
 * Every node is placed by the layout and nothing here moves one: not dragged,
 * connected, selected or focused by Vue Flow, since the card and the frame's
 * header hold the controls. What each node draws comes in through the slots, so
 * the host decides what a card or a frame says and this file how the flow holds
 * them: frames under the lines, cards over them.
 *
 * `motion` is the field's one switch for live work moving (`useGraphMotion`),
 * written on the flow as `data-motion`: a paused field, or one under reduced
 * motion, holds a live line still and wider instead of running a comet on it.
 */
import type { GraphMotion } from '@/widgets/work-item-graph/composables/useGraphMotion.ts'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import { GRAPH_FIELD_FLOOR } from '@/widgets/work-item-graph/utils/graphCamera.ts'
import { GRAPH_FLOW_ID } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { GRAPH_ZOOM_MAX, GRAPH_ZOOM_MIN } from '@/widgets/work-item-graph/utils/graphLayout.ts'

const { minZoom = GRAPH_ZOOM_MIN } = defineProps<{
  edges: FlowEdge[]
  motion: GraphMotion
  nodes: FlowNode[]
  /** The camera has framed the field, so its drawing may show. */
  settled: boolean
  /** The farthest out the camera goes, for the field as it is drawn now. */
  minZoom?: number
}>()

const emit = defineEmits<{
  'init': []
  'node-click': [id: string]
  'node-enter': [id: string]
  'node-leave': [id: string]
  'pane-leave': []
}>()

/**
 * How many pixels a hand may slip and still have pressed. Every press on the field starts
 * a pan, and past this the press was a drag, so it opens nothing: at no slip at all, one
 * pixel of a shaking hand on a far-out frame or card lost the press to a pan.
 */
const PRESS_SLOP = 4
</script>

<template>
  <VueFlow
    :id="GRAPH_FLOW_ID"
    class="graph-flow"
    zoom-activation-key-code="Control"
    no-pan-class-name="nopan"
    no-wheel-class-name="nowheel"
    :style="{ '--graph-field-floor': `${GRAPH_FIELD_FLOOR}px` }"
    :class="{ settled }"
    :data-motion="motion"
    :nodes="nodes"
    :edges="edges"
    :nodes-draggable="false"
    :nodes-connectable="false"
    :nodes-focusable="false"
    :disable-keyboard-a11y="true"
    :elements-selectable="false"
    :select-nodes-on-drag="false"
    :selection-key-code="false"
    :pan-on-drag="true"
    :pan-on-scroll="false"
    :pan-on-scroll-mode="PanOnScrollMode.Free"
    :zoom-on-scroll="true"
    :zoom-on-pinch="true"
    :zoom-on-double-click="false"
    :prevent-scrolling="true"
    :min-zoom="minZoom"
    :max-zoom="GRAPH_ZOOM_MAX"
    :pane-click-distance="PRESS_SLOP"
    :apply-default="false"
    @init="emit('init')"
    @node-mouse-enter="({ node }) => emit('node-enter', node.id)"
    @node-mouse-leave="({ node }) => emit('node-leave', node.id)"
    @node-click="({ node }) => emit('node-click', node.id)"
    @pane-mouse-leave="emit('pane-leave')"
  >
    <template #edge-routed="{ id, data, markerEnd }">
      <slot
        :id="id"
        name="edge"
        :data="data"
        :marker-end="markerEnd"
      />
    </template>
    <template #node-card="{ data }">
      <slot
        name="card"
        :data="data"
      />
    </template>
    <template #node-frame="{ data }">
      <slot
        name="frame"
        :data="data"
      />
    </template>
    <Background
      variant="dots"
      color="var(--color-rule)"
      :gap="24"
      :size="1"
    />
  </VueFlow>
</template>

<style scoped>
.graph-flow {
  /* The camera says how much a comet's stroke grows against a field zoomed far out. */
  --graph-comet-stroke-scale: 1;

  /* The field's floor, written over from `GRAPH_FIELD_FLOOR` by the template. */
  --graph-field-floor: 0px;

  /* As tall as the row the canvas leaves it between its strips (`GraphView`), and never
     shorter than its floor (`GRAPH_FIELD_FLOOR`): the row grows to the floor and the section
     scrolls, so the floor cannot run the field over the camera's strip, as a 360px floor the
     row did not hold once did. */
  width: 100%;
  height: 100%;
  min-height: var(--graph-field-floor);
  background: var(--color-surface-recess);
  overflow: hidden;

  /* A finger on the field moves the camera, never the section that scrolls round it in a
     short window. Vue Flow's zoom cancels each move it pans with; saying so here as well
     tells the browser before any script runs, so a busy frame cannot start a scroll. */
  touch-action: none;

  /* The field and its dots are drawn immediately; only the nodes wait for the
     camera, so opening the graph shows an empty field settling into a graph
     rather than a flash of oversized cards. */
  :deep(.vue-flow__transformationpane) {
    opacity: 0;
    transition: opacity var(--duration-surface) var(--ease-out);
  }

  &.settled :deep(.vue-flow__transformationpane) {
    opacity: 1;
  }
}

:deep(.vue-flow__background pattern circle) {
  fill: color-mix(in srgb, var(--color-rule) 70%, transparent);
}

/* Vue Flow draws its own box around a node; the card or the frame inside is
   the whole drawing, so the box gets out of its way. */
:deep(.vue-flow__node.graph-node) {
  border: 0;
  background: transparent;
  overflow: visible;
  border-radius: var(--radius-status);
}

/* A frame is ground the cards in it stand on, and its lines run over it. Its box
   takes the pointer, as Vue Flow writes on every node of a field that listens to
   them: a press there starts the same pan the field's does, and what it means
   besides is the frame's own to say. */
:deep(.vue-flow__node.graph-frame-node) {
  border: 0;
  background: transparent;
}

/* A drag that began on a frame says it is a drag, whatever that frame's ground says at rest. */
:deep(.vue-flow__pane.dragging .graph-frame-node > *) {
  cursor: grabbing;
}

:deep(.vue-flow__edge.graph-edge) {
  transition: opacity var(--duration-quick) var(--ease-out);
}

/* A line's hue and width change at once: a read can make it live or stop it
   being live, and a background update is never animated. Only its fading back
   while the pointer or the keyboard lights another lineage is eased, which the
   reader's own hand starts. */
:deep(.vue-flow__edge.graph-edge .vue-flow__edge-path) {
  fill: none;
  stroke: var(--color-graph-line);
  stroke-width: 1.6;
  transition: opacity var(--duration-quick) var(--ease-out);
}

/* Only a block is a hard dependency. Everything else the model can link —
   a discovery, a duplicate, a loose relation — is context, and reads as a
   dashed quieter line rather than as structure. */
:deep(.vue-flow__edge.graph-edge:not(.blocks) .vue-flow__edge-path) {
  stroke: var(--color-graph-line-muted);
  stroke-dasharray: 4 4;
}

/* A line live work runs along, held still: the field is paused or asked for
   less motion. It keeps its stroke — solid for a block, dashed for context —
   and says «work is going on» by the hue and the width alone. */
.graph-flow:not([data-motion='running'])
  :deep(.vue-flow__edge.graph-edge.live .vue-flow__edge-path) {
  stroke: var(--color-info);
  stroke-width: 2.4;
}

:deep(.vue-flow__edge.graph-edge.lit .vue-flow__edge-path) {
  stroke: var(--color-action-primary);
  stroke-width: 1.9;
}

:deep(.vue-flow__edge.graph-edge.recessed) {
  opacity: 0.16;
}

@media (prefers-reduced-motion: reduce) {
  .graph-flow :deep(.vue-flow__transformationpane),
  :deep(.vue-flow__edge.graph-edge .vue-flow__edge-path) {
    transition: none;
  }
}

/* A forced palette draws every line in its one ink, so a live line is told
   apart by the colour the palette keeps for what is picked out, and a width,
   whether it moves or not. */
@media (forced-colors: active) {
  :deep(.vue-flow__edge.graph-edge.live .vue-flow__edge-path) {
    stroke: Highlight;
    stroke-width: 3;
    forced-color-adjust: none;
  }
}
</style>
