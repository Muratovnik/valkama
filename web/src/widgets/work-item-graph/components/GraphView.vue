<script setup lang="ts">
/** Shared planning data supplies the field; Vue Flow owns camera and interaction. */
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import { Background } from '@vue-flow/background'
import { PanOnScrollMode, VueFlow } from '@vue-flow/core'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'
import GraphBar from '@/widgets/work-item-graph/components/GraphBar.vue'
import GraphControls from '@/widgets/work-item-graph/components/GraphControls.vue'
import GraphEdge from '@/widgets/work-item-graph/components/GraphEdge.vue'
import GraphEmptyState from '@/widgets/work-item-graph/components/GraphEmptyState.vue'
import GraphFieldCorner from '@/widgets/work-item-graph/components/GraphFieldCorner.vue'
import GraphLayoutStatus from '@/widgets/work-item-graph/components/GraphLayoutStatus.vue'
import GraphLegend from '@/widgets/work-item-graph/components/GraphLegend.vue'
import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import { useGraphCamera } from '@/widgets/work-item-graph/composables/useGraphCamera.ts'
import { useGraphFlowElements } from '@/widgets/work-item-graph/composables/useGraphFlowElements.ts'
import { useGraphKeyboard } from '@/widgets/work-item-graph/composables/useGraphKeyboard.ts'
import { useGraphNodeMarks } from '@/widgets/work-item-graph/composables/useGraphNodeMarks.ts'
import { useGraphProjection } from '@/widgets/work-item-graph/composables/useGraphProjection.ts'
import { GRAPH_FLOW_ID } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedNode } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { GRAPH_ZOOM_MAX, GRAPH_ZOOM_MIN } from '@/widgets/work-item-graph/utils/graphLayout.ts'
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
  /**
   * The branch of the chain the card chose: the epic it was filed under (`''`
   * for none), its members, and that epic's own id when the chain holds it.
   */
  branch?: { head: string | null; members: readonly string[]; reference: string } | null
  /** The chain this field is scoped to, named in its header chip. */
  chain?: { members: readonly string[]; reference: string; total: number } | null
  /** The queue and the search the items were narrowed by; a new one frames the field afresh. */
  filter?: string
  /** Moves each time the host asks the field to take focus once it is framed. */
  focusRequest?: number
  selectedId?: string | null
}>()

const emit = defineEmits<{ 'exit-branch': []; 'exit-chain': []; 'open': [reference: string] }>()
/** Whether a chain's closed members are drawn; the host keeps it in the address. */
const showClosed = defineModel<boolean>('showClosed', { default: false })

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
  showUnlinked,
  unlinked,
} = useGraphProjection(
  () => ({
    edges: props.edges,
    epicId: props.epicId,
    members: props.chain?.members,
    nodes: props.items,
    open: props.open,
    scopeKind: props.scopeKind,
    space: props.space,
    version: props.version,
  }),
  () => props.selectedId ?? null,
  showClosed,
  () => branchFrame.value?.ids ?? null,
)

/** Whether a drawing is on the field: a layout over it runs in the background. */
const drawn = computed(() => placed.value !== null)

/** Which empty the field is in, if any; the first cause wins. */
const emptyKind = computed(() => {
  if (emptySpace.value) return 'space'
  return emptyOpen.value ? 'open' : null
})

const readyIdSet = computed(() => new Set(ready.value.map((node) => node.work_item_id)))

/** The branch as drawn: framed whole and kept lit. None while nothing of it is on the field. */
const branchFrame = computed(() => {
  const branch = props.branch
  if (!branch || !placed.value) return null
  const wanted = new Set(branch.head === null ? branch.members : [branch.head, ...branch.members])
  const ids = new Set(
    placed.value.nodes.map((node) => node.work_item_id).filter((id) => wanted.has(id)),
  )
  return ids.size ? { headId: branch.head, ids } : null
})
/** Whether a node is in the branch the card chose. */
const inBranch = (node: PlacedNode) => branchFrame.value?.ids.has(node.work_item_id) ?? false
const branchChip = computed(() => (branchFrame.value ? (props.branch?.reference ?? null) : null))

/** Whether the space says this node is ready, asked per node it draws. */
function isReady(node: PlacedNode): boolean {
  return readyIdSet.value.has(node.work_item_id)
}

const {
  chainLegend,
  chainLegendNames,
  inChain,
  isChainRoot,
  isRecessed,
  nodeChainGroup,
  parentReference,
  referenceById,
} = useGraphNodeMarks({
  epicId: () => props.epicId,
  focusSet,
  items: () => props.items,
  members: () => props.chain?.members,
  placed,
  scopeKind: () => props.scopeKind,
})

// Vue Flow owns the camera and all viewport math. The store is keyed so the
// controls in the strip below and this field share one camera instance.
const { anchorId, fitted, fitOptions, overview, onFlowInit, reveal } = useGraphCamera({
  branch: () => branchFrame.value,
  flowId: GRAPH_FLOW_ID,
  placed,
  rootId: () => (inChain.value ? props.epicId : null),
  selectedId: () => props.selectedId ?? null,
  scopes: [
    () => props.space,
    () => props.scopeKind,
    () => props.epicId,
    () => props.branch?.reference,
  ],
  narrowings: [() => props.filter, showDone, showUnlinked],
})

/** The chain has closed members, so the key keeps the place «Done» comes and goes from. */
const keepDone = computed(() => inChain.value && hiddenDone.value > 0)
const hasEdges = computed(() => Boolean(placed.value?.edges.length))
/** Whether the field has a key to draw: the bar offers it on a narrow workspace. */
const keyed = computed(() => chainLegend.value.length > 0 || hasEdges.value)

const chainChip = computed(() =>
  props.chain ? { reference: props.chain.reference, total: props.chain.total } : null,
)

const { nodes: flowNodes, edges: flowEdges } = useGraphFlowElements({
  focusSet,
  placed,
  isChainRoot,
})

const {
  isTabStop,
  onFocus: keyboardFocus,
  onKeydown,
} = useGraphKeyboard({
  anchorId,
  canvas: useTemplateRef<HTMLElement>('canvas'),
  fitted,
  focusRequest: () => props.focusRequest,
  placed,
  reveal,
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
  if (keyboardFocus(id)) applyFocus({ type: 'focus', id })
}

function onNodeBlur(id: string) {
  applyFocus({ type: 'blur', id })
}

function onFieldPointerLeave() {
  applyFocus({ type: 'field-leave' })
}
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
      v-model:show-unlinked="showUnlinked"
      :chain="chainChip"
      :branch="branchChip"
      :open-total="openTotal"
      :hidden-done="hiddenDone"
      :ready-count="ready.length"
      :unlinked="unlinked"
      :keyed="keyed"
      @exit-chain="emit('exit-chain')"
      @exit-branch="emit('exit-branch')"
    >
      <template #legend>
        <GraphLegend
          :groups="chainLegend"
          :names="chainLegendNames"
          :has-edges="hasEdges"
          :keep-done="keepDone"
        />
      </template>
    </GraphBar>

    <GraphEmptyState
      v-if="emptyKind"
      :kind="emptyKind"
      :count="hiddenDone"
      @reveal="showDone = true"
    />

    <!-- Hover cleanup only: leaving the canvas with a pointer clears the hover -->
    <!-- highlight. Nothing here is reachable or actionable by pointer alone. -->
    <!-- The frame holds three rows: the key's strip, the flow, the controls' -->
    <!-- strip. The chrome is beside the flow rather than on it, so no node is -->
    <!-- ever drawn under it, however the camera stands. -->
    <!-- eslint-disable-next-line vuejs-accessibility/mouse-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
    <div
      v-show="!emptyKind"
      ref="canvas"
      class="graph-canvas"
      :class="[{ settled: fitted }]"
      @mouseleave="onFieldPointerLeave"
      @keydown="onKeydown"
    >
      <div class="graph-legend-place">
        <GraphLayoutStatus
          :drawn="drawn"
          :failed="failed"
          :pending="pending"
          @retry="retry"
        />
        <GraphFieldCorner
          :groups="chainLegend"
          :names="chainLegendNames"
          :has-edges="hasEdges"
          :keep-done="keepDone"
          :ready-count="ready.length"
        />
      </div>
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
            :recessed="isRecessed(data)"
            :marked="inBranch(data)"
            :chain-group="nodeChainGroup(data)"
            :parent-reference="parentReference(data)"
            :root="isChainRoot(data)"
            :overview="overview"
            :tabbable="isTabStop(data)"
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
      </VueFlow>
      <GraphControls :fit-options="fitOptions" />
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
  display: grid;
  flex: 1 1 auto;
  grid-template-rows: auto minmax(0, 1fr) auto;
  min-height: 0;
  padding: 0;
  border: 1px solid var(--color-rule);
  background: var(--color-surface-recess);
  overflow: hidden;
  border-radius: var(--radius-card);

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

.graph-legend-place {
  display: flex;
  justify-content: flex-end;
  align-items: center;

  /* The key's row is one line tall whether or not it draws anything yet, so a
     switch that brings the first link or state into it moves no node — and
     neither does the layout's own status, which stands at its start. */
  min-height: calc(24px + 2 * var(--space-2));
  padding: var(--space-2) var(--space-3);
}

.graph-flow {
  width: 100%;
  height: 100%;
  min-height: 360px;
  background: var(--color-surface-recess);
  overflow: hidden;
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
  /* The field is whatever the column leaves it. A floor taller than that would
     run the flow out of its box, and the camera controls with it. */
  .graph-flow {
    min-height: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .graph-canvas :deep(.vue-flow__transformationpane),
  :deep(.vue-flow__edge.graph-edge .vue-flow__edge-path) {
    transition: none;
  }
}
</style>
