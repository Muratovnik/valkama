<script setup lang="ts">
/**
 * Shared planning data supplies the field; Vue Flow owns camera and interaction.
 *
 * A drawn node is a place the layout gave an id. What it says — the item's
 * brief, a frame's counts — is read here by that id from what the host sent
 * last, so a frame of the stream that changes only those redraws the words and
 * leaves the places where they were.
 */
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import GraphBar from '@/widgets/work-item-graph/components/GraphBar.vue'
import GraphControls from '@/widgets/work-item-graph/components/GraphControls.vue'
import GraphEdge from '@/widgets/work-item-graph/components/GraphEdge.vue'
import GraphEmptyState from '@/widgets/work-item-graph/components/GraphEmptyState.vue'
import GraphField from '@/widgets/work-item-graph/components/GraphField.vue'
import GraphFieldCorner from '@/widgets/work-item-graph/components/GraphFieldCorner.vue'
import GraphFrame from '@/widgets/work-item-graph/components/GraphFrame.vue'
import GraphLayoutStatus from '@/widgets/work-item-graph/components/GraphLayoutStatus.vue'
import GraphLegend from '@/widgets/work-item-graph/components/GraphLegend.vue'
import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import { useGraphCamera } from '@/widgets/work-item-graph/composables/useGraphCamera.ts'
import { useGraphFlowElements } from '@/widgets/work-item-graph/composables/useGraphFlowElements.ts'
import { useGraphGroundTap } from '@/widgets/work-item-graph/composables/useGraphGroundTap.ts'
import { useGraphHover } from '@/widgets/work-item-graph/composables/useGraphHover.ts'
import { useGraphKeyboard } from '@/widgets/work-item-graph/composables/useGraphKeyboard.ts'
import { movesOn, useGraphMotion } from '@/widgets/work-item-graph/composables/useGraphMotion.ts'
import { useGraphNodeMarks } from '@/widgets/work-item-graph/composables/useGraphNodeMarks.ts'
import { useGraphProjection } from '@/widgets/work-item-graph/composables/useGraphProjection.ts'
import { GRAPH_FLOW_ID } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type {
  LiveWork,
  PlacedFrame,
  PlacedNode,
} from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { GraphScope } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { foldTarget, frameTarget } from '@/widgets/work-item-graph/utils/graphWalk.ts'

import { waitingOn } from '@/entities/work-item/utils/waiting.ts'

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
  /** What an agent's session is doing now on each item that has live work, by id. */
  live?: Readonly<Record<string, LiveWork>>
  selectedId?: string | null
  /** The whole space, when `items` is what a filter let through: frames count their epic's work. */
  spaceItems?: WorkItemBrief[]
}>()

const emit = defineEmits<{ 'exit-branch': []; 'exit-chain': []; 'open': [reference: string] }>()
/** Whether a chain's closed members are drawn; the host keeps it in the address. */
const showClosed = defineModel<boolean>('showClosed', { default: false })

const { t } = useI18n()

const {
  applyFocus,
  drawn: drawnField,
  emptyOpen,
  emptySpace,
  focusSet,
  hiddenDone,
  hovered,
  live,
  openTotal,
  placed,
  pending,
  failed,
  retry,
  ready,
  showDone,
  toggle,
} = useGraphProjection(
  () => ({
    edges: props.edges,
    epicId: props.epicId,
    live: props.live,
    members: props.chain?.members,
    nodes: props.items,
    open: props.open,
    scopeKind: props.scopeKind,
    space: props.space,
    spaceItems: props.spaceItems,
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

/** What each node waits on, read from the links the field was given. */
const waiting = computed(() => waitingOn(props.edges, props.items))
const waitingFor = (node: PlacedNode) => waiting.value.get(node.work_item_id) ?? null

/** What each drawn place says now: the projection lays today's briefs and counts on it by id. */
const cardById = computed(
  () => new Map(drawnField.value?.nodes.map((node) => [node.work_item_id, node]) ?? []),
)
const frameById = computed(
  () => new Map(drawnField.value?.frames.map((frame) => [frame.id, frame])),
)

/** The card drawn at a place: none, or one. */
const cardAt = (id: string) => [cardById.value.get(id)].filter((node) => node !== undefined)

/** The frame drawn at a place: none, or one. */
const frameAt = (id: string) => [frameById.value.get(id)].filter((frame) => frame !== undefined)

/**
 * The items whose live work moves: an agent is seen working on them now. A line runs when one
 * of its links reaches one, and a frame counts those under it. It stays the whole space's
 * set: a drawn line folded onto a frame reaches items no card shows.
 */
const moving = computed(
  () => new Set(Object.keys(live.value).filter((id) => movesOn(live.value[id]))),
)
const { motion, toggle: toggleMotion } = useGraphMotion()
const still = computed(() => motion.value !== 'running')
const workingIn = (frame: PlacedFrame) => frame.members.filter((id) => moving.value.has(id)).length
/**
 * Something on the field moves: a drawn card being worked on, or a drawn frame, folded or
 * open, that counts work moving under it. Only then do the key and the switch speak of motion.
 */
const anyMoving = computed(
  () =>
    [...cardById.value.keys()].some((id) => moving.value.has(id)) ||
    [...frameById.value.values()].some((frame) => workingIn(frame) > 0),
)
/**
 * A drawn card is held by a session not working on it now: the key names its still dots,
 * which a card zoomed out past reading does not draw.
 */
const anyHeld = computed(
  () =>
    !overview.value && [...cardById.value.keys()].some((id) => live.value[id]?.state === 'held'),
)
const liveOf = (node: PlacedNode) => live.value[node.work_item_id] ?? null

/** A card standing in a drawn frame: the frame names its epic, so the card does not. */
const isFramed = (node: PlacedNode) => frameById.value.has(node.frameId)

const { inChain, isChainRoot, isRecessed, legend, nodeChainGroup, parentReference, referenceById } =
  useGraphNodeMarks({
    epicId: () => props.epicId,
    focusSet,
    items: () => props.items,
    members: () => props.chain?.members,
    placed: drawnField,
    scopeKind: () => props.scopeKind,
  })

/** The epic chip, on a card no frame round it names. */
function chipFor(node: PlacedNode): string | undefined {
  return isFramed(node) ? undefined : parentReference(node)
}

// Vue Flow owns the camera and all viewport math. The store is keyed so the
// controls in the strip below and this field share one camera instance.
const {
  anchorId,
  cometStrokeScale,
  far,
  fitted,
  fitWhole,
  holdFrame,
  minZoom,
  overview,
  onFlowInit,
  reveal,
} = useGraphCamera({
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
  narrowings: [() => props.filter, showDone],
})

/** The chain has closed members, so the key keeps the place «Done» comes and goes from. */
const keepDone = computed(() => inChain.value && hiddenDone.value > 0)
/**
 * What the open-or-all switch counts. The whole space draws every item, as a card or as
 * the frame it heads, so the switch counts the items the counts line above counts; a
 * chain counts the nodes it draws.
 */
const switchCounts = computed(() => {
  if (props.scopeKind !== 'all') return { open: openTotal.value, done: hiddenDone.value }
  const open = props.items.filter((item) => !item.state.is_terminal).length
  return { open, done: props.items.length - open }
})
const hasEdges = computed(() => Boolean(placed.value?.edges.length))
/** Whether the field has a key to draw: the bar offers it on a narrow workspace. */
const keyed = computed(
  () => legend.value.groups.length > 0 || hasEdges.value || anyMoving.value || anyHeld.value,
)

const chainChip = computed(() =>
  props.chain ? { reference: props.chain.reference, total: props.chain.total } : null,
)

const { nodes: flowNodes, edges: flowEdges } = useGraphFlowElements({
  focusSet,
  placed: drawnField,
  moving,
})

const canvas = useTemplateRef<HTMLElement>('canvas')
useGraphGroundTap(canvas)

const {
  isTabStop,
  onFocus: keyboardFocus,
  onKeydown,
} = useGraphKeyboard({
  anchorId,
  canvas,
  fitted,
  focusRequest: () => props.focusRequest,
  overview,
  placed,
  reveal,
})

/**
 * A pointer resting on a card lights its lineage, and moving on to the next card
 * passes the field straight to that one's; a frame is ground and lights nothing.
 */
const hover = useGraphHover({
  apply: applyFocus,
  accepts: (id) => cardById.value.has(id),
  hovered: () => hovered.value,
})

function onNodeClick(id: string) {
  // Mouse and keyboard activation both arrive once through Vue Flow. A frame's
  // header holds its own two buttons, so a press on a frame opens nothing here.
  const reference = cardById.value.has(id) ? referenceById.value.get(id) : undefined
  if (reference) emit('open', reference)
}

function onNodeFocus(id: string) {
  if (keyboardFocus(id)) applyFocus({ type: 'focus', id })
}

function onNodeBlur(id: string) {
  applyFocus({ type: 'blur', id })
}

/** Which of a frame's two header buttons is the field's Tab stop, if either is. */
function frameStop(frame: PlacedFrame): string | null {
  return [foldTarget(frame.id), frameTarget(frame.id)].find((id) => isTabStop(id)) ?? null
}

/** A header button took focus: the keyboard stands on it; a frame lights no lineage. */
function onFrameFocus(target: string) {
  keyboardFocus(target)
}

/** Fold or open a frame with its header held where it was pressed. */
function toggleFrame(frameId: string) {
  holdFrame(frameId)
  toggle(frameId)
}

function onFieldPointerLeave() {
  hover.leaveField()
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
      :chain="chainChip"
      :branch="branchChip"
      :open-total="switchCounts.open"
      :hidden-done="switchCounts.done"
      :ready-count="ready.length"
      :keyed="keyed"
      @exit-chain="emit('exit-chain')"
      @exit-branch="emit('exit-branch')"
    >
      <template #legend>
        <GraphLegend
          :groups="legend.groups"
          :names="legend.names"
          :has-edges="hasEdges"
          :keep-done="keepDone"
          :moving="anyMoving"
          :held="anyHeld"
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
          :groups="legend.groups"
          :names="legend.names"
          :has-edges="hasEdges"
          :keep-done="keepDone"
          :ready-count="ready.length"
          :motion="motion"
          :moving="anyMoving"
          :held="anyHeld"
          @toggle-motion="toggleMotion"
        />
      </div>
      <GraphField
        :nodes="flowNodes"
        :edges="flowEdges"
        :settled="fitted"
        :min-zoom="minZoom"
        :motion="motion"
        :style="{ '--graph-comet-stroke-scale': cometStrokeScale }"
        @init="onFlowInit"
        @node-enter="hover.enter"
        @node-leave="hover.leave"
        @node-click="onNodeClick"
        @pane-leave="onFieldPointerLeave"
      >
        <template #edge="edgeProps">
          <GraphEdge
            :id="edgeProps.id"
            :data="edgeProps.data"
            :marker-end="edgeProps.markerEnd"
            :motion="motion"
          />
        </template>
        <template #frame="{ data }">
          <GraphFrame
            v-for="frame in frameAt(data.id)"
            :key="frame.id"
            :frame="frame"
            :far="far"
            :overview="overview"
            :tab-stop="frameStop(frame)"
            :working="workingIn(frame)"
            :still="still"
            @focus="onFrameFocus"
            @toggle="toggleFrame"
            @open="(reference) => emit('open', reference)"
          />
        </template>
        <template #card="{ data }">
          <GraphNodeCard
            v-for="node in cardAt(data.id)"
            :key="node.work_item_id"
            :node="node"
            :ready="isReady(node)"
            :recessed="isRecessed(node)"
            :marked="inBranch(node)"
            :framed="isFramed(node)"
            :chain-group="nodeChainGroup(node)"
            :parent-reference="chipFor(node)"
            :root="isChainRoot(node)"
            :overview="overview"
            :tabbable="isTabStop(node.work_item_id)"
            :waiting-on="waitingFor(node)"
            :live="liveOf(node)"
            :still="still"
            @focus="onNodeFocus"
            @blur="onNodeBlur"
          />
        </template>
      </GraphField>
      <GraphControls @fit="fitWhole" />
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
}

.graph-legend-place {
  display: flex;
  justify-content: flex-end;
  align-items: center;

  /* The key's row is one line tall whether or not it draws anything yet, so a
     switch that brings the first link or state into it moves no node — and
     neither does the layout's own status, which stands at its start. It is as
     tall as a pointer target, so the motion switch's target fits inside it:
     shorter, the flow under it and the field's edge above took its ends. */
  min-height: var(--size-control-target);
  padding: var(--space-2) var(--space-3);
}
</style>
