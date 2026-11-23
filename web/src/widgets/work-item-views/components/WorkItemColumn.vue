<script setup lang="ts">
/**
 * One workflow state as a column of work.
 *
 * The column exists because the workflow declares the state, not because the
 * product has six lanes. Its tone comes from the state's *category*, so a
 * renamed state keeps its reading and a second active state gets the same one.
 * The tiles and the way they cross to another state are the stack's; the column
 * is the ground they lie on, and what it is called.
 *
 * A column draws its tiles as the reader scrolls towards them. A space of a
 * thousand finished items drew a thousand tiles every time the board was
 * opened or regrouped, which held the page for over a tenth of a second while
 * only the first four could be seen. The column draws a page of them, and the
 * next page once the end of what is drawn comes within reach of the scroll. The
 * count in the header is always the whole state's.
 *
 * A column that folds (`useColumnFolds`) says so in its head, after its count: the press
 * folds it to a strip.
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useIntersectionObserver } from '@vueuse/core'

import WorkItemStack from '@/widgets/work-item-views/components/WorkItemStack.vue'
import type { StackLanding } from '@/widgets/work-item-views/components/WorkItemStack.vue'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { LiveWork } from '@/shared/api/liveWorkModel.ts'
import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { useStateName } from '@/shared/lib/useStateName.ts'
import DataEmptyState from '@/shared/ui/DataEmptyState.vue'
import SemanticState from '@/shared/ui/SemanticState.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  emptyLabel: string
  filter: WorkFilter
  items: WorkItemBrief[]
  /** What an agent's session is doing on each item with live work, by item id. */
  live: Readonly<Record<string, LiveWork>>
  state: WorkflowState
  waiting: Map<string, string>
  writable: boolean
  /** The column folds to a strip, and its head offers that. */
  foldable?: boolean
  hintId?: string
}>()

const emit = defineEmits<{
  dragging: [active: boolean]
  filter: [token: WorkFilterToken]
  fold: []
  open: [reference: string]
  place: [move: BoardMove, landing: StackLanding]
}>()

const stateName = useStateName()
const name = computed(() => stateName(props.state))
const { t } = useI18n()
const foldLabel = computed(() => t('workItem.columnFold.fold', { state: name.value }))

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
</script>

<template>
  <section
    class="work-item-column"
    :data-column-track="props.state.state_id"
    :data-state="props.state.key"
    :data-category="props.state.category"
  >
    <header class="column-head">
      <h2 class="column-name">
        <SemanticState
          aria-hidden="true"
          dimension="work-item-state"
          :state="props.state.category"
          :label="name"
        />
        <span class="visually-hidden">{{ name }}</span>
      </h2>
      <span class="column-count">{{ props.items.length }}</span>
      <VButton
        v-if="props.foldable"
        v-tooltip.name="foldLabel"
        class="column-fold-button"
        variant="ghost"
        size="inline"
        aria-expanded="true"
        :aria-label="foldLabel"
        :data-column-fold="props.state.state_id"
        icon
        reach
        @click="emit('fold')"
      >
        <VIcon
          name="chevron-left"
          :size="16"
        />
      </VButton>
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
        :waiting="props.waiting"
        :live="props.live"
        :filter="props.filter"
        :hint-id="props.hintId"
        :writable="props.writable"
        @dragging="emit('dragging', $event)"
        @filter="emit('filter', $event)"
        @open="emit('open', $event)"
        @place="(move, landing) => emit('place', move, landing)"
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

  /* A forced palette clears the ground, and with it where one state ends and the next begins. */
  @media (forced-colors: active) {
    border: 1px solid currentcolor;
  }

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

  .column-fold-button {
    margin-inline-start: auto;
  }
}

/* A tile brought into view stops short of the edge by more than its focus ring
   reaches (2px out, 2px wide), so the moved tile's ring is seen whole at the
   top and at the bottom; flush with the edge, only one side of it was. */
.column-scroll {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 72px;
  padding: var(--space-1) 0;
  overflow-y: auto;
  scrollbar-gutter: stable;
  scroll-padding-block: var(--space-2);
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
