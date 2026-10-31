<script setup lang="ts">
/**
 * One planning space, in whichever of the three views the operator chose.
 *
 * All three read the same answer. The Board era shipped a payload already
 * grouped into six lanes, so Kanban *was* the model and the list and the graph
 * each fetched again and took the grouping apart; here the workflow, the items
 * and the links arrive once and each view projects what it needs. That is why a
 * state renamed in the workflow renames a column, a row and a node together.
 */
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import WorkItemBoard from '@/widgets/work-item-views/components/WorkItemBoard.vue'
import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { inWorkQueue } from '@/shared/api/planningModel.ts'
import type { PlanningReadModel, WorkQueue } from '@/shared/api/planningModel.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'
import VTextInput from '@/shared/ui/VTextInput.vue'

const props = defineProps<{
  model: PlanningReadModel
  stale: boolean
  version: number
  view: PlanningViewMode
  writable: boolean
  /** The chain the graph is scoped to, when the owner asked to see one. */
  chain?: WorkItemChain | null
  /** The route names a chain whose first read is still in flight. */
  chainPending?: boolean
  scopeKey?: string
  selectedId?: string | null
  warning?: string
}>()

const emit = defineEmits<{
  'create': []
  'exit-chain': []
  'open': [reference: string]
  'transition': [reference: string, stateKey: string]
  'view': [mode: PlanningViewMode]
}>()

/** The graph pulls in Vue Flow, which no other view needs on first paint. */
const WorkItemGraph = defineAsyncComponent(
  () => import('@/widgets/work-item-graph/components/GraphView.vue'),
)

export type PlanningViewMode = 'graph' | 'kanban' | 'list'

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
const filtered = computed(() => Boolean(searchTerm.value) || queue.value !== 'all')
const emptyTitle = computed(() =>
  t(searchTerm.value ? 'workItem.searchEmpty' : 'workItem.queueEmpty'),
)
function resetFilters() {
  query.value = ''
  queue.value = 'all'
}
const queues: WorkQueue[] = ['all', 'ready', 'assigned', 'blocked', 'review']
const queueOptions = computed(() =>
  queues.map((value) => ({ value, label: t(`workItem.queue.${value}`) })),
)
const visibleItems = computed(() =>
  props.model.work_items.filter(
    (item) =>
      inWorkQueue(item, queue.value) &&
      (!searchTerm.value ||
        item.reference.toLocaleLowerCase().includes(searchTerm.value) ||
        item.title.toLocaleLowerCase().includes(searchTerm.value)),
  ),
)

/** What the graph needs of a chain: who is in it, and what to call it. */
const graphChain = computed(() =>
  props.chain
    ? {
        members: props.chain.members.map((member) => member.work_item_id),
        reference: props.chain.root.reference,
        total: props.chain.total,
      }
    : null,
)

/** The whole space, or exactly one chain with the links the chain endpoint named. */
const graphScopeKind = computed(() => (props.chain ? 'chain' : 'all'))
const graphEdges = computed(() => props.chain?.edges ?? props.model.links)

const VIEW_MODES: readonly PlanningViewMode[] = ['kanban', 'list', 'graph']

const viewSegments = computed(() =>
  VIEW_MODES.map((mode) => ({ value: mode, label: t(`workItem.view.${mode}`) })),
)

/**
 * `aria-busy` while a refresh is in flight, and absent otherwise.
 *
 * Absent rather than `false`: the counts are not busy between refreshes, and
 * `aria-busy="false"` is a claim about a state the row is not in.
 */
const countsBusy = computed(() => (props.stale ? true : undefined))

const counts = computed(() => {
  const items = props.model.work_items
  return {
    total: items.length,
    open: items.filter((item) => !item.state.is_terminal).length,
    held: items.filter((item) => item.claim_ref !== '' && !item.state.is_terminal).length,
  }
})
</script>

<template>
  <main
    class="workspace"
    :aria-label="t('platform.modules.planning')"
  >
    <header class="workspace-head">
      <SegmentedControl
        :model-value="view"
        :options="viewSegments"
        :label="t('workItem.viewLabel')"
        @update:model-value="(mode) => emit('view', mode)"
      />
      <SegmentedControl
        v-model="queue"
        class="workspace-queue"
        :options="queueOptions"
        :label="t('workItem.queueLabel')"
      />
      <span
        class="workspace-counts"
        :aria-busy="countsBusy"
        >{{ t('workItem.spaceCounts', counts) }}</span
      >
      <VButton
        v-if="writable"
        variant="primary"
        @click="emit('create')"
      >
        <span aria-hidden="true">+</span>{{ t('workItem.create') }}
      </VButton>
      <p
        v-else
        class="workspace-note"
        role="status"
        data-state="unavailable"
      >
        <VIcon
          name="info"
          class="workspace-note-icon"
          :size="16"
        />{{ t('platform.coreWrites.primaryOwnerRequired') }}
      </p>
    </header>

    <p
      v-if="warning"
      class="workspace-note"
      role="status"
    >
      {{ warning }}
    </p>
    <div class="workspace-search">
      <VTextInput
        v-model="query"
        :label="t('workItem.searchLabel')"
        :placeholder="t('workItem.searchPlaceholder')"
      />
      <VButton
        v-if="query"
        @click="query = ''"
        >{{ t('workItem.clearSearch') }}</VButton
      >
      <span
        v-if="filtered"
        class="workspace-counts"
        role="status"
        >{{
          t('workItem.matchCount', { count: visibleItems.length, total: model.work_items.length })
        }}</span
      >
    </div>
    <div class="workspace-stage">
      <DataEmptyState
        v-if="!visibleItems.length && filtered"
        :title="emptyTitle"
        :description="t('workItem.filterContext', { queue: t(`workItem.queue.${queue}`) })"
      >
        <template #action
          ><VButton @click="resetFilters">{{ t('workItem.resetFilters') }}</VButton></template
        >
      </DataEmptyState>
      <WorkItemBoard
        v-if="view === 'kanban' && model.workflow"
        v-show="visibleItems.length || !filtered"
        :workflow="model.workflow"
        :items="visibleItems"
        :links="model.links"
        @open="(reference) => emit('open', reference)"
        @transition="(reference, stateKey) => emit('transition', reference, stateKey)"
      />
      <WorkItemList
        v-else-if="view === 'list'"
        v-show="visibleItems.length || !filtered"
        :items="visibleItems"
        :links="model.links"
        @open="(reference) => emit('open', reference)"
      />
      <p
        v-else-if="view === 'graph' && chainPending"
        class="workspace-note"
        role="status"
      >
        {{ t('workItem.chain.loading') }}
      </p>
      <WorkItemGraph
        v-else-if="view === 'graph'"
        v-show="visibleItems.length || !filtered"
        :scope-kind="graphScopeKind"
        :space="model.planning_space?.planning_space_id ?? ''"
        :items="visibleItems"
        :selected-id="selectedId"
        :edges="graphEdges"
        :epic-id="chain?.root.work_item_id ?? null"
        :chain="graphChain"
        :open="true"
        :version="version"
        @exit-chain="emit('exit-chain')"
        @open="(reference) => emit('open', reference)"
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

/* One grammar across every module: the view switcher on the left, where the eye
   starts, and the one primary action on the right. */
.workspace-head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: center;
  min-width: 0;

  & > :last-child {
    margin-inline-start: auto;
  }
}

.workspace-queue {
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
}

.workspace-search {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  align-items: end;
}

.workspace-counts {
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.workspace-stage {
  display: grid;
  flex: 1 1 auto;
  min-height: 0;
}

.workspace-note {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  max-width: 54ch;
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);

  .workspace-note-icon {
    flex: 0 0 auto;
    margin-top: var(--space-hair);
  }
}

@container workspace (width <= 556px) {
  .workspace {
    padding-inline: var(--space-3);
  }

  .workspace-head {
    flex-direction: column;
    align-items: stretch;
  }
}
</style>
