<script setup lang="ts">
/**
 * One planning space, in whichever of the three views the operator chose.
 *
 * All three read the same answer. The Board era shipped a payload already
 * grouped into six lanes, so Kanban *was* the model and the list and the graph
 * each fetched again and took the grouping apart; here the workflow, the items
 * and the links arrive once and each view projects what it needs. That is why a
 * state renamed in the workflow renames a column, a row and a node together.
 *
 * A chain the route names narrows every view, not only the graph: the board and
 * the list draw its members and its root, with the same chip to leave it, and
 * switching views keeps it. The graph draws the scope itself, so it still gets
 * the whole space and the chain beside it.
 *
 * The filter is the workspace's too, and every view reads it: a mark clicked
 * on any of them reaches it as one token, the bar edits it, and the address
 * keeps it so a reload and Back come back to the same narrowing.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePlanningCensus } from '@/pages/planning/composables/usePlanningCensus.ts'
import type { ViewGrouping } from '@/pages/planning/composables/usePlanningChainScope.ts'
import { usePlanningFilter } from '@/pages/planning/composables/usePlanningFilter.ts'
import PlanningChainFailure from '@/pages/planning/PlanningChainFailure.vue'
import PlanningWorkspaceBar from '@/pages/planning/PlanningWorkspaceBar.vue'
import { graphView } from '@/pages/planning/utils/graphView.ts'

import WorkItemBoard from '@/widgets/work-item-views/components/WorkItemBoard.vue'
import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import { filterTokens } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import { uiLoading, uiReady } from '@/shared/api/platformUiState.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { LOADING_DELAY_MS } from '@/shared/ui/loadingPresence.ts'
import PlatformStatePanel from '@/shared/ui/PlatformStatePanel.vue'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  model: PlanningReadModel
  /** The module's route state, where the filter is kept. */
  routeState: Record<string, string | number | boolean> | undefined
  stale: boolean
  /** The manifest's bound on that state. */
  stateBytes: number
  version: number
  view: PlanningViewMode
  /** The planning space whose saved views the bar offers. */
  viewPlace: string
  writable: boolean
  /** The chain the views are narrowed to, when the owner asked to see one. */
  chain?: WorkItemChain | null
  /** The branch of the chain the graph is framed on: an epic's reference, `''` for no epic. */
  chainBranch?: string | null
  /** The graph draws the chain's closed members too; the route keeps it. */
  chainClosed?: boolean
  /** The chain the route names could not be read; the views show the whole space. */
  chainFailure?: { message: string; retryable: boolean } | null
  /** The route names a chain whose first read is still in flight. */
  chainPending?: boolean
  /** Moves each time the card asks for the graph, which then takes focus. */
  graphFocus?: number
  /** How the views are grouped: the board by parent, the list by goal, or not at all. */
  grouping?: ViewGrouping
  /** The space is being read: the bar stands, and the stage says so in place of a view. */
  reading?: boolean
  selectedId?: string | null
}>()

const emit = defineEmits<{
  'chain-closed': [closed: boolean]
  'create': []
  'exit-branch': []
  'exit-chain': []
  'find': [text: string]
  'group': [grouping: ViewGrouping]
  'open': [reference: string]
  'place': [move: BoardMove]
  'retry-chain': []
  'show-chain': [reference: string]
  'state': [state: Record<string, string | number | boolean>]
  'view': [mode: PlanningViewMode]
}>()

/** The graph pulls in Vue Flow, which no other view needs on first paint. */
const WorkItemGraph = graphView.component

export type PlanningViewMode = 'graph' | 'kanban' | 'list'

/**
 * The view the stage draws, which trails the chosen one only while the graph's
 * code is still downloading.
 *
 * A switch to the graph keeps the board or the list on screen until the graph
 * can replace it, so the stage never blanks between the two. Once the download
 * has run for the loading delay the graph's own boundary takes the stage and
 * says it is loading, or that it failed and can be retried.
 */
const stageView = ref<PlanningViewMode>(props.view)
let releaseTimer: ReturnType<typeof setTimeout> | undefined
function releaseGraph() {
  clearTimeout(releaseTimer)
  if (props.view === 'graph') stageView.value = 'graph'
}
watch(
  () => props.view,
  (mode) => {
    clearTimeout(releaseTimer)
    if (mode !== 'graph' || graphView.ready.value) {
      stageView.value = mode
      return
    }
    releaseTimer = setTimeout(releaseGraph, LOADING_DELAY_MS)
    graphView.load().then(releaseGraph, releaseGraph)
  },
)
onBeforeUnmount(() => clearTimeout(releaseTimer))

const { t } = useI18n()

/**
 * A space switch clears the filter where the switch is written, so it leaves
 * the address with the old space; Back to that space brings it back.
 */
const {
  filter,
  reset: resetFilter,
  set: setFilter,
  stored: filterStored,
  toggle: toggleFilter,
} = usePlanningFilter({
  state: () => props.routeState,
  maxBytes: () => props.stateBytes,
  write: (state) => emit('state', state),
})
const boardGrouping = computed(() => (props.grouping === 'epic' ? 'epic' : 'none'))
const census = usePlanningCensus(() => ({
  chain: props.chain ?? null,
  filter: filter.value,
  grouping: boardGrouping.value,
  space: props.model.work_items,
  view: stageView.value,
}))
const {
  counted: countedItems,
  counts,
  filtered,
  matched: matchedItems,
  scope: scopeItems,
  visible: visibleItems,
} = census
/**
 * The list grouped by goal is a tree of the whole scope: what the filter let
 * through, with the path to it. Grouped or not, it is another list, made anew.
 */
const listTree = computed(() =>
  props.grouping === 'goal'
    ? {
        filtered: filtered.value,
        scope: scopeItems.value,
        space: props.model.planning_space?.planning_space_id ?? '',
      }
    : null,
)
/** The workflow's state categories in its own order: what the state facet offers. */
const categories = computed(() => [
  ...new Set((props.model.workflow?.states ?? []).map((state) => state.category)),
])
/** What the graph needs of a chain: who is in it, and what to call it. */
const graphChain = computed(() =>
  props.chain
    ? {
        members: props.chain.members.map((member) => member.work_item_id),
        reference: props.chain.root.reference,
        total: countedItems.value.length,
      }
    : null,
)

/**
 * The branch of the chain the graph is framed on, as the chain's own answer
 * lists it — the members filed under that epic, or under none — and the epic
 * itself, which heads it when it is in the chain.
 */
const graphBranch = computed(() => {
  const chain = props.chain
  const branch = props.chainBranch
  if (!chain || branch === null || branch === undefined) return null
  const members = chain.members
    .filter((member) => (member.parent_reference ?? '') === branch)
    .map((member) => member.work_item_id)
  const head =
    branch === chain.root.reference
      ? chain.root.work_item_id
      : chain.members.find((member) => branch !== '' && member.reference === branch)?.work_item_id
  return { reference: branch, members, head: head ?? null }
})

/** What the items are narrowed by: the graph frames a new narrowing afresh, and only then. */
const graphFilter = computed(() =>
  JSON.stringify([
    filterTokens(filter.value),
    filter.value.text.trim().toLocaleLowerCase(),
    // How labels combine narrows nothing until there are two to combine.
    (filter.value.labels?.length ?? 0) > 1 ? filter.value.labelsMatch : undefined,
  ]),
)

/** The whole space, or exactly one chain with the links the chain endpoint named. */
const graphScopeKind = computed(() => (props.chain ? 'chain' : 'all'))
const graphEdges = computed(() => props.chain?.edges ?? props.model.links)

/** The chain the board or the list is narrowed to, for the bar's chip; the graph names its own. */
const chipReference = computed(() =>
  props.chain && stageView.value !== 'graph' ? props.chain.root.reference : null,
)
/** The grouping of the view on the stage, and what it offers; the graph has none. */
const barGrouping = computed<ViewGrouping | null>(() => {
  if (stageView.value === 'kanban') return boardGrouping.value
  if (stageView.value === 'list') return listTree.value ? 'goal' : 'none'
  return null
})
const barGroupings = computed<readonly ViewGrouping[]>(() =>
  stageView.value === 'list' ? ['none', 'goal'] : ['none', 'epic'],
)
/** The list's key, which makes it anew when it turns from a flat list to a tree. */
const listKind = computed(() => (listTree.value ? 'tree' : 'flat'))
/**
 * What the view leaves out of the counts: the graph's parents, which the bar
 * says as a sentence, and the grouped board's epics, which it says as rows.
 */
const barExclusion = computed(() => census.exclusion.value)

/**
 * What the stage stands for: a read under way, or the views. The panel holds the stage for
 * the whole life of the workspace and draws the views in its slot, so the rule of a wait
 * is its to keep — a read that answered just after it said so keeps saying it long enough
 * to be read — and its status region stands before a switch of space starts a read again.
 *
 * A chain the route names is part of the same read: a view takes the stage once its space
 * is read and that chain is too. It used to say «Reading the chain…» in a line of its own
 * from the first frame, so a chain that answered in a tenth of a second flashed it.
 */
const READING = uiLoading()
const STAGED = uiReady(true)
const stageReading = computed(() => props.reading === true || props.chainPending === true)
const stageState = computed(() => (stageReading.value ? READING : STAGED))

/** A mark pressed outside the views — the card beside them — reaches the same filter. */
defineExpose({ toggleFilter })
</script>

<template>
  <main
    class="workspace"
    :aria-label="t('platform.modules.planning')"
  >
    <PlanningWorkspaceBar
      :busy="stale"
      :reading="reading"
      :categories="categories"
      :chain="chipReference"
      :counts="counts"
      :exclusion="barExclusion"
      :filter="filter"
      :filtered="filtered"
      :grouping="barGrouping"
      :groupings="barGroupings"
      :items="countedItems"
      :stored="filterStored"
      :route-state="routeState"
      :view-place="viewPlace"
      :view="view"
      :writable="writable"
      @update:filter="setFilter"
      @create="emit('create')"
      @exit-chain="emit('exit-chain')"
      @find="(text) => emit('find', text)"
      @group="(value) => emit('group', value)"
      @state="(state) => emit('state', state)"
      @view="(mode) => emit('view', mode)"
    />

    <PlanningChainFailure
      v-if="chainFailure"
      :failure="chainFailure"
      @dismiss="emit('exit-chain')"
      @retry="emit('retry-chain')"
    />
    <div class="workspace-stage">
      <PlatformStatePanel
        :state="stageState"
        compact
      >
        <DataEmptyState
          v-if="!matchedItems.length && filtered"
          :title="t('workItem.filter.empty')"
          :description="t('workItem.filter.emptyHint')"
        >
          <template #action
            ><VButton @click="resetFilter">{{ t('workItem.filter.resetAll') }}</VButton></template
          >
        </DataEmptyState>
        <WorkItemBoard
          v-if="stageView === 'kanban' && model.workflow"
          v-show="matchedItems.length || !filtered"
          :workflow="model.workflow"
          :items="visibleItems"
          :scope-items="scopeItems"
          :space-items="model.work_items"
          :space-id="model.planning_space?.planning_space_id ?? ''"
          :links="model.links"
          :filter="filter"
          :filtered="filtered"
          :grouping="boardGrouping"
          :live="model.live_work"
          :writable="writable"
          @chain="(reference) => emit('show-chain', reference)"
          @filter="toggleFilter"
          @open="(reference) => emit('open', reference)"
          @place="(move) => emit('place', move)"
        />
        <WorkItemList
          v-else-if="stageView === 'list'"
          v-show="matchedItems.length || !filtered"
          :key="listKind"
          :items="visibleItems"
          :links="model.links"
          :filter="filter"
          :tree="listTree"
          @filter="toggleFilter"
          @open="(reference) => emit('open', reference)"
        />
        <WorkItemGraph
          v-else-if="stageView === 'graph'"
          v-show="matchedItems.length || !filtered"
          :scope-kind="graphScopeKind"
          :space="model.planning_space?.planning_space_id ?? ''"
          :items="visibleItems"
          :space-items="model.work_items"
          :live="model.live_work"
          :selected-id="selectedId"
          :edges="graphEdges"
          :epic-id="chain?.root.work_item_id ?? null"
          :chain="graphChain"
          :filter="graphFilter"
          :branch="graphBranch"
          :focus-request="graphFocus"
          :show-closed="chainClosed"
          :open="true"
          :version="version"
          @exit-chain="emit('exit-chain')"
          @exit-branch="emit('exit-branch')"
          @open="(reference) => emit('open', reference)"
          @update:show-closed="(closed) => emit('chain-closed', closed)"
        />
      </PlatformStatePanel>
    </div>
  </main>
</template>

<style scoped>
/* The stage owns the remaining height and each view scrolls inside it, so the
   header row never leaves and the page itself never scrolls sideways. */
.workspace {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-3);
  min-width: 0;
  min-height: 0;
  padding: var(--space-5) var(--size-page-gutter) var(--space-5);
  background: var(--color-canvas);
}

.workspace-stage {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
}

/* The space being read says so where its work will start, not in the middle of the stage,
   for as long as the panel holds its wait. */
.workspace-stage:has(> .platform-state-panel) {
  align-items: start;
}

@container workspace (width <= 624px) {
  .workspace {
    padding-inline: var(--space-3);
  }
}
</style>
