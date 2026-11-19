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
import { VIEW_GROUPINGS } from '@/pages/planning/composables/usePlanningChainScope.ts'
import type { ViewGrouping } from '@/pages/planning/composables/usePlanningChainScope.ts'
import { usePlanningFilter } from '@/pages/planning/composables/usePlanningFilter.ts'
import PlanningChainFailure from '@/pages/planning/PlanningChainFailure.vue'
import PlanningWorkspaceBar from '@/pages/planning/PlanningWorkspaceBar.vue'
import { graphView } from '@/pages/planning/utils/graphView.ts'
import { sortOf, withSort } from '@/pages/planning/utils/viewSortRoute.ts'

import WorkItemBoard from '@/widgets/work-item-views/components/WorkItemBoard.vue'
import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'
import type { ViewSort } from '@/widgets/work-item-views/utils/workOrder.ts'

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
  /** The branch of the chain the graph is framed on: a goal's reference, `''` for no goal. */
  chainBranch?: string | null
  /** The graph draws the chain's closed members too; the route keeps it. */
  chainClosed?: boolean
  /** The chain the route names could not be read; the views show the whole space. */
  chainFailure?: { message: string; retryable: boolean } | null
  /** The route names a chain whose first read is still in flight. */
  chainPending?: boolean
  /** Moves each time the card asks for the graph, which then takes focus. */
  graphFocus?: number
  /** How the address groups the views; a view that does not offer it draws none. */
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
/** The grouping of each view: the address's where the view offers it, none elsewhere. */
const offered = (mode: PlanningViewMode) =>
  VIEW_GROUPINGS[mode].includes(props.grouping ?? 'none') ? (props.grouping ?? 'none') : 'none'
const boardGrouping = computed(() => offered('kanban'))
const listGrouping = computed(() => offered('list'))
/** The order the board and the list draw in, which the address keeps (`viewSortRoute`). */
const sort = computed(() => sortOf(props.routeState))
const setSort = (next: ViewSort) => emit('state', withSort(props.routeState, next))
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
 * through, with the path to it; by project, a row per project with its cards under
 * it. Grouped or not, and by either, it is another list, made anew.
 */
const listTree = computed(() => {
  const grouping = listGrouping.value
  if (grouping !== 'goal' && grouping !== 'project') return null
  return {
    filtered: filtered.value,
    grouping,
    projects: props.model.planning_space?.projects ?? null,
    scope: scopeItems.value,
    space: props.model.planning_space?.planning_space_id ?? '',
  }
})
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
 * lists it — the members filed under that goal, or under none — and the goal
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
const barGrouping = computed<ViewGrouping | null>(() =>
  stageView.value === 'graph' ? null : offered(stageView.value),
)
const barGroupings = computed(() => VIEW_GROUPINGS[stageView.value])
/** The order of the view on the stage; the graph is drawn by its links and has none. */
const barSort = computed(() => (stageView.value === 'graph' ? null : sort.value))
/** The list's key, which makes it anew when its grouping turns. */
const listKind = computed(() => listTree.value?.grouping ?? 'flat')
/**
 * What the view leaves out of the counts: the graph's parents, which the bar
 * says as a sentence, and the grouped board's goals, which it says as rows.
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
      :sort="barSort"
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
      @sort="setSort"
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
          :projects="model.planning_space?.projects ?? null"
          :sort="sort"
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
          :space-items="model.work_items"
          :sort="sort"
          @filter="toggleFilter"
          @open="(reference) => emit('open', reference)"
          @sort="setSort"
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
          :scope-root-id="chain?.root.work_item_id ?? null"
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
