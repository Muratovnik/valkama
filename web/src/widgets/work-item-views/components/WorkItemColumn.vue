<script setup lang="ts">
/**
 * One workflow state as a column of work.
 *
 * The column exists because the workflow declares the state, not because the
 * product has six lanes. Its tone comes from the state's *category*, so a
 * renamed state keeps its reading and a second active state gets the same one.
 */
import { ref } from 'vue'

import { useSortable } from '@vueuse/integrations/useSortable'

import WorkItemTile from '@/widgets/work-item-views/components/WorkItemTile.vue'

import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'

const props = defineProps<{
  blockedIds: Set<string>
  emptyLabel: string
  items: WorkItemBrief[]
  readyIds: Set<string>
  state: WorkflowState
}>()

const emit = defineEmits<{
  dragging: [active: boolean]
  moved: [reference: string, stateKey: string]
  open: [reference: string]
}>()

// Readiness and blockedness are the space's answer, handed down as two sets; a
// column asks about the item it is drawing rather than deciding either.
const isReady = (item: WorkItemBrief) => props.readyIds.has(item.work_item_id)
const isBlocked = (item: WorkItemBrief) => props.blockedIds.has(item.work_item_id)

const list = ref<HTMLElement | null>(null)
let draggedAt = 0

useSortable(list, props.items, {
  group: 'work-items',
  animation: 150,
  onStart: () => emit('dragging', true),
  onEnd: (event: { item: HTMLElement; to: HTMLElement }) => {
    emit('dragging', false)
    draggedAt = Date.now()
    const reference = event.item.dataset.reference
    const target = event.to.dataset.state
    if (reference && target) emit('moved', reference, target)
  },
})

/** A click that lands within a quarter second of a drop was the drop. */
function open(reference: string) {
  if (Date.now() - draggedAt > 250) emit('open', reference)
}
</script>

<template>
  <section
    class="work-item-column"
    :data-state="props.state.key"
    :data-category="props.state.category"
  >
    <header class="column-head">
      <h2 class="column-name">
        <SemanticState
          aria-hidden="true"
          dimension="work-item-state"
          :state="props.state.category"
          :label="props.state.name"
        />
        <span class="visually-hidden">{{ props.state.name }}</span>
      </h2>
      <span class="column-count">{{ props.items.length }}</span>
    </header>
    <div class="column-scroll">
      <ul
        ref="list"
        class="column-stack"
        :data-state="props.state.key"
      >
        <li
          v-for="item in props.items"
          :key="item.work_item_id"
          :data-reference="item.reference"
        >
          <WorkItemTile
            :item="item"
            :ready="isReady(item)"
            :blocked="isBlocked(item)"
            @open="open"
          />
        </li>
      </ul>
      <DataEmptyState
        v-if="!props.items.length"
        :title="props.emptyLabel"
        compact
      />
    </div>
  </section>
</template>

<style scoped>
/* A ground the sheets lie on, separated by a tonal step and a radius rather
   than by an outline. */
.work-item-column {
  display: flex;
  flex-direction: column;
  min-width: 250px;
  height: 100%;
  min-height: 0;
  padding: var(--space-3) var(--space-2) var(--space-2) var(--space-3);
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-card);

  /* The count belongs beside the state's name, not at the far edge of the
     column: six numbers pushed right form a column of their own that means
     nothing read alone. */
  .column-head {
    display: flex;
    flex: 0 0 auto;
    gap: var(--space-2);
    align-items: center;
    padding: 0 var(--space-1) var(--space-2) 0;
  }

  .column-name {
    margin: 0;
  }

  .column-count {
    color: var(--color-text-muted);
    font: var(--font-count);
    font-variant-numeric: tabular-nums;
  }
}

.column-scroll {
  position: relative;
  flex: 1 1 auto;
  min-height: 72px;
  padding: var(--space-1) var(--space-1) var(--space-1) 0;
  overflow-y: auto;
}

/* The space between two sheets belongs to the stack, so it is a gap and is
   never spent after the last one. */
.column-stack {
  display: grid;
  gap: var(--space-2);
  min-height: 18px;
  padding: 0;
  margin: 0;
  list-style: none;
}
</style>
