<script setup lang="ts">
/**
 * The flow itself: Vue Flow, held to a field that is read and never edited, and
 * the look of what the library renders round the field's own drawings.
 *
 * Every node is placed by the layout and nothing here moves one: not dragged,
 * connected, selected or focused by Vue Flow, since the card and the frame's
 * header hold the controls. What each node draws comes in through the slots, so
 * the host decides what a card or a frame says and this file how the flow holds
 * them: frames under the lines, cards over them.
 */
import { Background } from '@vue-flow/background'
import { PanOnScrollMode, VueFlow } from '@vue-flow/core'
import type { Edge as FlowEdge, Node as FlowNode } from '@vue-flow/core'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import { GRAPH_FLOW_ID } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { GRAPH_ZOOM_MAX, GRAPH_ZOOM_MIN } from '@/widgets/work-item-graph/utils/graphLayout.ts'

defineProps<{
  edges: FlowEdge[]
  nodes: FlowNode[]
  /** The camera has framed the field, so its drawing may show. */
  settled: boolean
}>()

const emit = defineEmits<{
  'init': []
  'node-click': [id: string]
  'node-enter': [id: string]
  'node-leave': [id: string]
  'pane-leave': []
}>()
</script>

<template>
  <VueFlow
    :id="GRAPH_FLOW_ID"
    class="graph-flow"
    zoom-activation-key-code="Control"
    no-pan-class-name="nopan"
    no-wheel-class-name="nowheel"
    :class="{ settled }"
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
    :min-zoom="GRAPH_ZOOM_MIN"
    :max-zoom="GRAPH_ZOOM_MAX"
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
  width: 100%;
  height: 100%;
  min-height: 360px;
  background: var(--color-surface-recess);
  overflow: hidden;

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

/* A frame is ground the cards in it stand on, and its lines run over it: Vue
   Flow would let the open box swallow every click meant for the field behind
   it, so only what the frame draws takes the pointer. */
:deep(.vue-flow__node.graph-frame-node) {
  border: 0;
  background: transparent;
  pointer-events: none;
}

:deep(.vue-flow__edge.graph-edge) {
  transition: opacity var(--duration-quick) var(--ease-out);
}

:deep(.vue-flow__edge.graph-edge .vue-flow__edge-path) {
  fill: none;
  stroke: var(--color-graph-line);
  stroke-width: 1.6;
  transition:
    opacity var(--duration-quick) var(--ease-out),
    stroke var(--duration-quick) var(--ease-out);
}

/* Only a block is a hard dependency. Everything else the model can link —
   a discovery, a duplicate, a loose relation — is context, and reads as a
   dashed quieter line rather than as structure. */
:deep(.vue-flow__edge.graph-edge:not(.blocks) .vue-flow__edge-path) {
  stroke: var(--color-graph-line-muted);
  stroke-dasharray: 4 4;
}

:deep(.vue-flow__edge.graph-edge.lit .vue-flow__edge-path) {
  stroke: var(--color-action-primary);
  stroke-width: 1.9;
}

:deep(.vue-flow__edge.graph-edge.recessed) {
  opacity: 0.16;
}

@container workspace (width <= 586px) {
  /* The field is whatever the column leaves it. A floor taller than that would
     run the flow out of its box, and the camera controls with it. */
  .graph-flow {
    min-height: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .graph-flow :deep(.vue-flow__transformationpane),
  :deep(.vue-flow__edge.graph-edge .vue-flow__edge-path) {
    transition: none;
  }
}
</style>
