<script setup lang="ts">
/**
 * One workflow state as a column of work.
 *
 * The column exists because the workflow declares the state, not because the
 * product has six lanes. Its tone comes from the state's *category*, so a
 * renamed state keeps its reading and a second active state gets the same one.
 * The tiles and the ways to reorder them are the stack's; the column is the
 * ground they lie on, and what it is called.
 *
 * A column draws its tiles as the reader scrolls towards them. A space of a
 * thousand finished items drew a thousand tiles every time the board was
 * opened or regrouped, which held the page for over a tenth of a second while
 * only the first four could be seen. The column draws a page of them, and the
 * next page once the end of what is drawn comes within reach of the scroll; a
 * tile moved from the keyboard past that end is drawn where it lands. The count
 * in the header is always the whole state's.
 */
import { ref } from 'vue'

import { useIntersectionObserver } from '@vueuse/core'

import WorkItemStack from '@/widgets/work-item-views/components/WorkItemStack.vue'
import type { StackLanding } from '@/widgets/work-item-views/components/WorkItemStack.vue'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'

const props = defineProps<{
  blockedIds: Set<string>
  emptyLabel: string
  items: WorkItemBrief[]
  readyIds: Set<string>
  state: WorkflowState
  writable: boolean
  hintId?: string
}>()

const emit = defineEmits<{
  dragging: [active: boolean]
  edge: [reference: string, edge: 'first' | 'last']
  open: [reference: string]
  place: [move: BoardMove, landing: StackLanding]
}>()

/** Tiles drawn at first, and added each time the end of them comes near. */
const PAGE = 30

const scroll = ref<HTMLElement | null>(null)
const end = ref<HTMLElement | null>(null)
const drawn = ref(PAGE)

useIntersectionObserver(
  end,
  ([entry]) => {
    if (entry?.isIntersecting) drawn.value += PAGE
  },
  { root: scroll, rootMargin: '0px 0px 600px 0px' },
)

function placed(move: BoardMove, landing: StackLanding) {
  if (landing.keyboard && landing.position >= drawn.value) drawn.value = landing.position + PAGE
  emit('place', move, landing)
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
    <div
      ref="scroll"
      class="column-scroll"
    >
      <WorkItemStack
        class="column-stack"
        group="work-items"
        :state="props.state"
        :items="props.items"
        :limit="drawn"
        :ready-ids="props.readyIds"
        :blocked-ids="props.blockedIds"
        :hint-id="props.hintId"
        :writable="props.writable"
        @dragging="emit('dragging', $event)"
        @edge="(reference, edge) => emit('edge', reference, edge)"
        @open="emit('open', $event)"
        @place="placed"
      />
      <div
        v-if="drawn < props.items.length"
        ref="end"
        class="column-end"
        aria-hidden="true"
      />
      <DataEmptyState
        v-if="!props.items.length"
        class="column-empty"
        :title="props.emptyLabel"
        compact
      />
    </div>
  </section>
</template>

<style scoped>
/* A ground the sheets lie on, separated by a tonal step and a radius rather
   than by an outline. The end inset is the start inset less the scrollbar the
   stack keeps a gutter for, so a sheet stands centred in its lane whether the
   lane scrolls or not. It used to sit 12px from the start and 22px from the
   end, which read as every card shifted towards the left. */
.work-item-column {
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
  min-height: 0;
  padding: var(--space-3) calc(var(--space-3) - var(--size-scrollbar)) var(--space-2) var(--space-3);
  background: var(--color-surface);
  overflow: hidden;
  border-radius: var(--radius-card);
  scroll-snap-align: start;

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
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 72px;
  padding: var(--space-1) 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
}

/* The stack fills the column, so a tile dropped anywhere below the last one
   lands last rather than nowhere; the empty note lies over that floor. */
.column-stack {
  flex: 1 0 auto;
}

.column-end {
  flex: 0 0 1px;
}

.column-empty {
  position: absolute;
  inset: var(--space-1) 0 auto;
  pointer-events: none;
}
</style>
