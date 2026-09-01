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
import { computed, defineAsyncComponent } from 'vue'
import { useI18n } from 'vue-i18n'

import WorkItemBoard from '@/widgets/work-item-views/components/WorkItemBoard.vue'
import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'

import type { PlanningReadModel } from '@/shared/api/planningModel.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  model: PlanningReadModel
  /** True while a refresh is in flight over an already drawn space. */
  stale: boolean
  version: number
  view: PlanningViewMode
  writable: boolean
}>()

const emit = defineEmits<{
  create: []
  open: [reference: string]
  transition: [reference: string, stateKey: string]
  view: [mode: PlanningViewMode]
}>()

/** The graph pulls in Vue Flow, which no other view needs on first paint. */
const WorkItemGraph = defineAsyncComponent(
  () => import('@/widgets/work-item-graph/components/GraphView.vue'),
)

export type PlanningViewMode = 'graph' | 'kanban' | 'list'

const { t } = useI18n()

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
    held: items.filter((item) => item.claim_ref !== '').length,
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

    <div class="workspace-stage">
      <WorkItemBoard
        v-if="view === 'kanban' && model.workflow"
        :workflow="model.workflow"
        :items="model.work_items"
        :links="model.links"
        @open="(reference) => emit('open', reference)"
        @transition="(reference, stateKey) => emit('transition', reference, stateKey)"
      />
      <WorkItemList
        v-else-if="view === 'list'"
        :items="model.work_items"
        :links="model.links"
        @open="(reference) => emit('open', reference)"
      />
      <WorkItemGraph
        v-else-if="view === 'graph'"
        scope-kind="all"
        :space="model.planning_space?.planning_space_id ?? ''"
        :items="model.work_items"
        :edges="model.links"
        :epic-id="null"
        :open="true"
        :version="version"
        @open="(reference) => emit('open', reference)"
      />
    </div>
  </main>
</template>

<style scoped>
/* The stage owns the remaining height and each view scrolls inside it, so the
   header row never leaves and the page itself never scrolls sideways. */
.workspace {
  display: grid;
  flex: 1 1 auto;
  grid-template-rows: auto minmax(0, 1fr);
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
  gap: var(--space-3);
  align-items: center;
  min-width: 0;

  & > :last-child {
    margin-inline-start: auto;
  }
}

.workspace-counts {
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.workspace-stage {
  display: grid;
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
