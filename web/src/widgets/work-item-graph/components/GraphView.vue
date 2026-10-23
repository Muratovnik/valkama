<script setup lang="ts">
/** Shared planning data supplies the field; Vue Flow owns camera and interaction. */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { Background } from '@vue-flow/background'
import { MarkerType, PanOnScrollMode, Position, useVueFlow, VueFlow } from '@vue-flow/core'
import type { Edge as FlowEdge, Node as FlowNode } from '@vue-flow/core'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import GraphBar from '@/widgets/work-item-graph/components/GraphBar.vue'
import GraphControls from '@/widgets/work-item-graph/components/GraphControls.vue'
import GraphEdge from '@/widgets/work-item-graph/components/GraphEdge.vue'
import GraphLayoutStatus from '@/widgets/work-item-graph/components/GraphLayoutStatus.vue'
import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import { useGraphProjection } from '@/widgets/work-item-graph/composables/useGraphProjection.ts'
import { graphCameraView } from '@/widgets/work-item-graph/utils/graphCamera.ts'
import { NODE_HEIGHT, NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import {
  edgeKey,
  flowEdge,
  GRAPH_ZOOM_MAX,
  GRAPH_ZOOM_MIN,
  graphFitViewOptions,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphScope } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

const props = defineProps<{
  edges: PlanningEdge[]
  epicId: string | null
  items: WorkItemBrief[]
  open: boolean
  scopeKind: GraphScope['kind']
  space: string
  version: number
  selectedId?: string | null
}>()

const emit = defineEmits<{ open: [reference: string] }>()

const GRAPH_FLOW_ID = 'valkama-work-graph'

const { t } = useI18n()

const {
  applyFocus,
  emptyOpen,
  emptySpace,
  focusSet,
  hiddenDone,
  openTotal,
  placed,
  pending,
  failed,
  retry,
  ready,
  showDone,
} = useGraphProjection(
  () => ({
    edges: props.edges,
    epicId: props.epicId,
    nodes: props.items,
    open: props.open,
    scopeKind: props.scopeKind,
    space: props.space,
    version: props.version,
  }),
  () => props.selectedId ?? null,
)

const flowReady = ref(false)
const fitted = ref(false)

const readyIdSet = computed(() => new Set(ready.value.map((node) => node.work_item_id)))

// Containers are named by reference on their children.

const referenceById = computed(
  () => new Map(props.items.map((item) => [item.work_item_id, item.reference])),
)

/** A lit edge takes the accent; an unlit discovery stays quieter than a block. */
function edgeMarkerColor(lit: boolean, kind: PlanningEdge['kind']): string {
  if (lit) return 'var(--color-action-primary)'
  return kind === 'blocks' ? 'var(--color-graph-line)' : 'var(--color-graph-line-muted)'
}

/** Whether the space says this node is ready, asked per node it draws. */
function isReady(node: PlacedNode): boolean {
  return readyIdSet.value.has(node.work_item_id)
}

/** The parent's reference, or nothing when the node is a root. */
function parentReference(node: PlacedNode): string | undefined {
  return node.parent_id === null ? undefined : referenceById.value.get(node.parent_id)
}

/** Outside the focused lineage, which is a fact about the field and not the node. */
function isRecessed(id: string): boolean {
  const focused = focusSet.value
  return focused ? !focused.ids.has(id) : false
}

const flowNodes = computed<FlowNode<PlacedNode>[]>(() => {
  if (!placed.value) return []
  return placed.value.nodes.map((node) => ({
    id: node.work_item_id,
    type: 'card' as const,
    position: { x: node.x, y: node.y },
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    draggable: false,
    connectable: false,
    selectable: false,
    focusable: false,
    ariaLabel: `${node.reference} ${node.title} · ${node.state.name}`,
    class: 'graph-node',
    data: node,
  }))
})

const flowEdges = computed<FlowEdge[]>(() => {
  if (!placed.value) return []
  const focusedEdges = focusSet.value?.edges
  return placed.value.edges.map((edge) => {
    const key = edgeKey(edge)
    const lit = focusedEdges?.has(key) ?? false
    const recessed = focusedEdges != null && !lit
    const markerColor = edgeMarkerColor(lit, edge.kind)
    const descriptor = flowEdge(edge, { markerColor, lit, recessed })
    return {
      ...descriptor,
      markerEnd: { ...descriptor.markerEnd, type: MarkerType.ArrowClosed },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    } as FlowEdge
  })
})

// Vue Flow owns the camera and all viewport math. The store is keyed so the
// Controls child and this component share one camera instance.
const { dimensions, setViewport } = useVueFlow({ id: GRAPH_FLOW_ID })
const fitOptions = graphFitViewOptions()
let cameraRequest = 0

onBeforeUnmount(() => {
  cameraRequest += 1
})

function onFlowNodeMouseEnter(event: { node: { id: string } }) {
  applyFocus({ type: 'pointer-enter', id: event.node.id })
}

function onFlowNodeMouseLeave(event: { node: { id: string } }) {
  applyFocus({ type: 'pointer-leave', id: event.node.id })
}

function onFlowNodeClick(event: { node: { id: string } }) {
  // Mouse and keyboard activation both arrive once through Vue Flow.
  const reference = referenceById.value.get(event.node.id)
  if (reference) emit('open', reference)
}

function onNodeFocus(id: string) {
  applyFocus({ type: 'focus', id })
}

function onNodeBlur(id: string) {
  applyFocus({ type: 'blur', id })
}

function onFieldPointerLeave() {
  applyFocus({ type: 'field-leave' })
}

// Keep nodes hidden until the initial readable camera has settled.

function scheduleFitView(focusOnly = false) {
  if (!flowReady.value || (fitted.value && !focusOnly)) return
  const request = ++cameraRequest
  void nextTick(async () => {
    if (!flowReady.value || request !== cameraRequest || !placed.value) return
    const camera = graphCameraView(placed.value, dimensions.value, readyIdSet.value, {
      selectedId: props.selectedId,
      focusOnly,
    })
    if (!camera) return
    const positioned = await setViewport(camera, { duration: 0 })
    if (request === cameraRequest && positioned) fitted.value = true
  })
}

function onFlowInit() {
  flowReady.value = true
  scheduleFitView()
}

// Filter projections replace nodes while the initialized Vue Flow canvas stays mounted.
watch(
  () => placed.value,
  (projection) => {
    if (projection) return
    cameraRequest += 1
    fitted.value = false
  },
)

watch(placed, () => scheduleFitView())
watch([() => dimensions.value.width, () => dimensions.value.height], () => {
  fitted.value = false
  scheduleFitView()
})
watch([() => props.space, () => props.scopeKind, () => props.epicId, showDone], () => {
  fitted.value = false
  scheduleFitView()
})
</script>

<template>
  <section
    v-show="open"
    class="graph"
    :aria-label="t('graph.title')"
    :aria-busy="pending"
  >
    <GraphBar
      v-model:show-done="showDone"
      :open-total="openTotal"
      :hidden-done="hiddenDone"
      :ready-count="ready.length"
      :has-edges="Boolean(placed?.edges.length)"
    />

    <GraphLayoutStatus
      :failed="failed"
      :pending="pending"
      @retry="retry"
    />
    <p
      v-if="emptySpace"
      class="graph-empty"
    >
      {{ t('graph.empty') }}
    </p>
    <div
      v-else-if="emptyOpen"
      class="graph-empty graph-empty-open"
    >
      <span>{{ t('graph.emptyOpen') }}</span>
      <button
        class="graph-show-done"
        type="button"
        @click="showDone = true"
      >
        {{ t('graph.showDone', { count: hiddenDone }) }}
      </button>
    </div>

    <!-- Hover cleanup only: leaving the canvas with a pointer clears the hover -->
    <!-- highlight. Nothing here is reachable or actionable by pointer alone. -->
    <!-- eslint-disable-next-line vuejs-accessibility/mouse-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
    <div
      v-show="!emptySpace && !emptyOpen"
      class="graph-canvas"
      :class="[{ settled: fitted }]"
      @mouseleave="onFieldPointerLeave"
    >
      <VueFlow
        :id="GRAPH_FLOW_ID"
        class="graph-flow"
        zoom-activation-key-code="Control"
        no-pan-class-name="nopan"
        no-wheel-class-name="nowheel"
        :nodes="flowNodes"
        :edges="flowEdges"
        :nodes-draggable="false"
        :nodes-connectable="false"
        :nodes-focusable="false"
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
        @init="onFlowInit"
        @node-mouse-enter="onFlowNodeMouseEnter"
        @node-mouse-leave="onFlowNodeMouseLeave"
        @node-click="onFlowNodeClick"
        @pane-mouse-leave="onFieldPointerLeave"
      >
        <template #edge-routed="edgeProps">
          <GraphEdge
            :id="edgeProps.id"
            :data="edgeProps.data"
            :marker-end="edgeProps.markerEnd"
          />
        </template>
        <template #node-card="{ data }">
          <GraphNodeCard
            :node="data"
            :ready="isReady(data)"
            :recessed="isRecessed(data.work_item_id)"
            :parent-reference="parentReference(data)"
            @focus="onNodeFocus"
            @blur="onNodeBlur"
          />
        </template>
        <Background
          variant="dots"
          color="var(--color-rule)"
          :gap="24"
          :size="1"
        />
        <GraphControls
          :fit-options="fitOptions"
          @focus-work="scheduleFitView(true)"
        />
      </VueFlow>
    </div>
  </section>
</template>

<style scoped>
.graph {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  background: var(--color-surface-recess);
}

.graph-canvas {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  padding: 0;
  overflow: hidden;

  /* The field, the dots and the frame are drawn immediately; only the nodes wait
     for the camera, so opening the graph shows an empty field settling into a
     graph rather than a flash of oversized cards. */
  :deep(.vue-flow__transformationpane) {
    opacity: 0;
    transition: opacity var(--duration-surface) var(--ease-out);
  }

  &.settled :deep(.vue-flow__transformationpane) {
    opacity: 1;
  }
}

.graph-flow {
  width: 100%;
  height: 100%;
  min-height: 360px;
  border: 1px solid var(--color-rule);
  background: var(--color-surface-recess);
  overflow: hidden;
  border-radius: var(--radius-card);
}

.graph-empty {
  padding: var(--space-7) 0;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-note);
}

.graph-empty-open {
  display: flex;
  gap: var(--space-4);
  align-items: center;
}

.graph-show-done {
  height: 30px;
  padding: 0 var(--space-3);
  color: var(--color-action-primary);
  font: var(--font-chip);
  background: var(--color-control-surface);
  border-radius: var(--radius-status);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }
}

:deep(.vue-flow__background pattern circle) {
  fill: color-mix(in srgb, var(--color-rule) 70%, transparent);
}

/* Vue Flow draws its own box around a node; the card inside is the whole
   drawing, so the box gets out of its way. */
:deep(.vue-flow__node.graph-node) {
  border: 0;
  background: transparent;
  overflow: visible;
  border-radius: var(--radius-status);
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
  .graph-flow {
    min-height: 300px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .graph-canvas :deep(.vue-flow__transformationpane),
  :deep(.vue-flow__edge.graph-edge .vue-flow__edge-path) {
    transition: none;
  }
}
</style>
