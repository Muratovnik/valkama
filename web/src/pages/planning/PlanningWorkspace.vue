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
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { usePlanningCensus } from '@/pages/planning/composables/usePlanningCensus.ts'
import PlanningChainFailure from '@/pages/planning/PlanningChainFailure.vue'
import PlanningWorkspaceBar from '@/pages/planning/PlanningWorkspaceBar.vue'
import { graphView } from '@/pages/planning/utils/graphView.ts'

import WorkItemBoard from '@/widgets/work-item-views/components/WorkItemBoard.vue'
import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'
import type { BoardGrouping } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningReadModel, WorkQueue } from '@/shared/api/planningModel.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import { LAZY_VIEW_LOADING_DELAY_MS } from '@/shared/ui/lazyView.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  model: PlanningReadModel
  stale: boolean
  version: number
  view: PlanningViewMode
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
  /** How the board is grouped: not at all, or into one lane per epic. */
  grouping?: BoardGrouping
  scopeKey?: string
  selectedId?: string | null
  warning?: string
}>()

const emit = defineEmits<{
  'chain-closed': [closed: boolean]
  'create': []
  'exit-branch': []
  'exit-chain': []
  'group': [grouping: BoardGrouping]
  'open': [reference: string]
  'place': [move: BoardMove]
  'retry-chain': []
  'show-chain': [reference: string]
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
    releaseTimer = setTimeout(releaseGraph, LAZY_VIEW_LOADING_DELAY_MS)
    graphView.load().then(releaseGraph, releaseGraph)
  },
)
onBeforeUnmount(() => clearTimeout(releaseTimer))

const { t } = useI18n()

const queue = ref<WorkQueue>('all')
const query = ref('')
const searchTerm = computed(() => query.value.trim().toLocaleLowerCase())
watch(
  () => props.scopeKey ?? props.model.planning_space?.planning_space_id,
  () => {
    query.value = ''
  },
)
const boardGrouping = computed(() => props.grouping ?? 'none')
const census = usePlanningCensus(() => ({
  chain: props.chain ?? null,
  grouping: boardGrouping.value,
  queue: queue.value,
  search: searchTerm.value,
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
const emptyTitle = computed(() =>
  t(searchTerm.value ? 'workItem.searchEmpty' : 'workItem.queueEmpty'),
)
function resetFilters() {
  query.value = ''
  queue.value = 'all'
}
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

/** The whole space, or exactly one chain with the links the chain endpoint named. */
const graphScopeKind = computed(() => (props.chain ? 'chain' : 'all'))
const graphEdges = computed(() => props.chain?.edges ?? props.model.links)

/** The chain the board or the list is narrowed to, for the bar's chip; the graph names its own. */
const chipReference = computed(() =>
  props.chain && stageView.value !== 'graph' ? props.chain.root.reference : null,
)
/** The board's grouping while the board is on the stage, which is when it can be grouped. */
const barGrouping = computed(() => (stageView.value === 'kanban' ? boardGrouping.value : null))
/** How many counted items the queue and the search let through, when either narrows. */
const matchCount = computed(() => (filtered.value ? matchedItems.value.length : null))
</script>

<template>
  <main
    class="workspace"
    :aria-label="t('platform.modules.planning')"
  >
    <PlanningWorkspaceBar
      v-model:queue="queue"
      v-model:query="query"
      :busy="stale"
      :chain="chipReference"
      :counts="counts"
      :exclusion="census.exclusion.value"
      :grouping="barGrouping"
      :matches="matchCount"
      :view="view"
      :writable="writable"
      @create="emit('create')"
      @exit-chain="emit('exit-chain')"
      @group="(value) => emit('group', value)"
      @view="(mode) => emit('view', mode)"
    />

    <p
      v-if="warning"
      class="workspace-note"
      role="status"
    >
      {{ warning }}
    </p>
    <PlanningChainFailure
      v-if="chainFailure"
      :failure="chainFailure"
      @dismiss="emit('exit-chain')"
      @retry="emit('retry-chain')"
    />
    <div class="workspace-stage">
      <p
        v-if="chainPending"
        class="workspace-note"
        role="status"
      >
        {{ t('workItem.chain.loading') }}
      </p>
      <DataEmptyState
        v-else-if="!matchedItems.length && filtered"
        :title="emptyTitle"
        :description="t('workItem.filterContext', { queue: t(`workItem.queue.${queue}`) })"
      >
        <template #action
          ><VButton @click="resetFilters">{{ t('workItem.resetFilters') }}</VButton></template
        >
      </DataEmptyState>
      <WorkItemBoard
        v-if="!chainPending && stageView === 'kanban' && model.workflow"
        v-show="matchedItems.length || !filtered"
        :workflow="model.workflow"
        :items="visibleItems"
        :scope-items="scopeItems"
        :space-items="model.work_items"
        :space-id="model.planning_space?.planning_space_id ?? ''"
        :links="model.links"
        :filtered="filtered"
        :grouping="boardGrouping"
        :writable="writable"
        @chain="(reference) => emit('show-chain', reference)"
        @open="(reference) => emit('open', reference)"
        @place="(move) => emit('place', move)"
      />
      <WorkItemList
        v-else-if="!chainPending && stageView === 'list'"
        v-show="matchedItems.length || !filtered"
        :items="visibleItems"
        :links="model.links"
        @open="(reference) => emit('open', reference)"
      />
      <WorkItemGraph
        v-else-if="!chainPending && stageView === 'graph'"
        v-show="matchedItems.length || !filtered"
        :scope-kind="graphScopeKind"
        :space="model.planning_space?.planning_space_id ?? ''"
        :items="visibleItems"
        :selected-id="selectedId"
        :edges="graphEdges"
        :epic-id="chain?.root.work_item_id ?? null"
        :chain="graphChain"
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

/* A line of text about the stage: a warning, or the chain still being read. */
.workspace-note {
  max-width: 54ch;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

@container workspace (width <= 556px) {
  .workspace {
    padding-inline: var(--space-3);
  }
}
</style>
