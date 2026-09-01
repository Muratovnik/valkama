<script setup lang="ts">
/**
 * Kanban: one column per workflow state, over the same model the list and the
 * graph read.
 *
 * The columns come from `workflow.states`, in the order the workflow gives
 * them. Nothing here knows there are six, or that one of them is called Dev.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import WorkItemColumn from '@/widgets/work-item-views/components/WorkItemColumn.vue'

import { byState, readyIds } from '@/shared/api/planningModel.ts'
import type { PlanningEdge, PlanningWorkflow, WorkItemBrief } from '@/shared/api/planningModel.ts'

const props = defineProps<{
  items: WorkItemBrief[]
  links: PlanningEdge[]
  workflow: PlanningWorkflow
}>()

const emit = defineEmits<{
  dragging: [active: boolean]
  open: [reference: string]
  transition: [reference: string, stateKey: string]
}>()

const { t } = useI18n()

const columns = computed(() => byState(props.workflow, props.items))
const ready = computed(() => readyIds(props.items))
const blocked = computed(() => {
  const open = new Set(
    props.items.filter((item) => !item.state.is_terminal).map((item) => item.work_item_id),
  )
  return new Set(
    props.links
      .filter((link) => link.kind === 'blocks' && open.has(link.from))
      .map((link) => link.to),
  )
})
</script>

<template>
  <div
    class="work-item-board"
    :style="{ '--column-count': columns.length }"
  >
    <WorkItemColumn
      v-for="column in columns"
      :key="column.state.state_id"
      :state="column.state"
      :items="column.items"
      :ready-ids="ready"
      :blocked-ids="blocked"
      :empty-label="t('workItem.columnEmpty')"
      @dragging="emit('dragging', $event)"
      @moved="(reference, stateKey) => emit('transition', reference, stateKey)"
      @open="emit('open', $event)"
    />
  </div>
</template>

<style scoped>
/* One track per state, sized by the workflow rather than by a constant. The
   board scrolls sideways when the workflow is wider than the module; each
   column owns its own vertical scroll, so the header row never leaves. */
.work-item-board {
  /* The count comes from the workflow as an inline custom property; the
     declaration here is the fallback, so a board with no inline style is one
     wide rather than zero. */
  --column-count: 1;

  display: grid;
  grid-template-columns: repeat(var(--column-count), minmax(250px, 1fr));
  gap: var(--space-2);
  height: 100%;
  min-height: 0;
  overflow: auto hidden;

  /* This board owns horizontal scrolling. Paint containment keeps off-screen
     lanes from enlarging the hidden Planning shell while preserving access
     to every lane through this scrollport. */
  contain: paint;
}
</style>
