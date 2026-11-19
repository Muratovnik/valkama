<script setup lang="ts">
/**
 * Kanban: one column per workflow state, over the same model the list and the
 * graph read — or, grouped, one lane of those columns per goal, per stage or per
 * project (`boardLanes`).
 *
 * The columns come from `workflow.states`, in the order the workflow gives
 * them, the terminal states last. Nothing here knows there are six, or that one
 * of them is called Dev.
 * A state's tiles stand in the order the view asks for (`orderedWork`), the queue's
 * unless it says, inside each column and each lane: a tile dragged to another column is handed up as the state it
 * goes to, for the page to send. What the move did is said aloud here, because a
 * reader who moved a tile without looking needs to hear where it went.
 *
 * A goal or a stage stands as a tile only while nobody has accepted it (`standsAsTile`);
 * after that it is a lane. A column of work put off starts folded to a strip of its name
 * and count (`useColumnFolds`), flat and over the lanes alike, and a press on the strip or
 * on the open column's head moves focus to the control that undoes it.
 */
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import WorkItemColumn from '@/widgets/work-item-views/components/WorkItemColumn.vue'
import WorkItemColumnFold from '@/widgets/work-item-views/components/WorkItemColumnFold.vue'
import WorkItemLanes from '@/widgets/work-item-views/components/WorkItemLanes.vue'
import type { StackLanding } from '@/widgets/work-item-views/components/WorkItemStack.vue'
import { useColumnFit } from '@/widgets/work-item-views/composables/useColumnFit.ts'
import { useColumnFolds } from '@/widgets/work-item-views/composables/useColumnFolds.ts'
import {
  byState,
  FOLDED_COLUMN,
  standsAsTile,
  terminalLast,
} from '@/widgets/work-item-views/utils/boardColumns.ts'
import { boardLanes } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardGrouping } from '@/widgets/work-item-views/utils/boardLanes.ts'
import { newestClosedFirst } from '@/widgets/work-item-views/utils/boardOrder.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'
import { orderedWork, QUEUE_ORDER } from '@/widgets/work-item-views/utils/workOrder.ts'
import type { ViewSort } from '@/widgets/work-item-views/utils/workOrder.ts'

import { waitingOn } from '@/entities/work-item/utils/waiting.ts'
import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { LiveWork } from '@/shared/api/liveWorkModel.ts'
import type {
  PlanningEdge,
  PlanningWorkflow,
  WorkflowState,
  WorkItemBrief,
} from '@/shared/api/planningModel.ts'
import { useStandingName, useStateName } from '@/shared/lib/useStateName.ts'

const props = withDefaults(
  defineProps<{
    items: WorkItemBrief[]
    links: PlanningEdge[]
    workflow: PlanningWorkflow
    /** The filter in force, so a label chip already in it offers to come out. */
    filter?: WorkFilter
    /** A queue or search filter narrowed `items`. */
    filtered?: boolean
    grouping?: BoardGrouping
    /** What an agent's session is doing on each item with live work, by item id. */
    live?: Readonly<Record<string, LiveWork>>
    /** The space's projects, which the lanes by project are; none where it has none. */
    projects?: readonly { display_name: string; project_id: string }[] | null
    /** The items the board is scoped to before any filter; `items` when absent. */
    scopeItems?: WorkItemBrief[]
    /** The order inside each column; the queue's unless it says. */
    sort?: ViewSort
    /** The planning space, which names goals outside the scope and owns the folded lanes. */
    spaceId?: string
    spaceItems?: WorkItemBrief[]
    writable?: boolean
  }>(),
  {
    filter: () => EMPTY_WORK_FILTER,
    filtered: false,
    grouping: 'none',
    live: () => ({}),
    projects: null,
    scopeItems: undefined,
    sort: () => QUEUE_ORDER,
    spaceId: '',
    spaceItems: undefined,
    writable: true,
  },
)

const emit = defineEmits<{
  chain: [reference: string]
  /** A tile's label, kind or priority was clicked: the token the filter gains or loses. */
  filter: [token: WorkFilterToken]
  open: [reference: string]
  place: [move: BoardMove]
}>()

const { t } = useI18n()
const hintId = `${useId()}-keys`

const standingName = useStandingName()
/**
 * The items in the order the board draws them. In the queue's order, from its start,
 * Done stands newest closed first, as it always has: the queue gives none of it.
 */
const ordered = computed(() => {
  const tiles = props.items.filter(standsAsTile)
  const sorted = orderedWork(tiles, props.sort, standingName, props.scopeItems)
  return props.sort.key === 'queue' && !props.sort.descending ? newestClosedFirst(sorted) : sorted
})
const columns = computed(() => terminalLast(byState(props.workflow, ordered.value)))
const states = computed(() => columns.value.map((column) => column.state))
/** How many tiles each state's column draws, which a folded strip says. */
const held = computed(
  () => new Map(columns.value.map((column) => [column.state.state_id, column.items.length])),
)
const folds = useColumnFolds({
  filtered: () => props.filtered,
  holds: (state) => held.value.get(state.state_id) ?? 0,
  space: () => props.spaceId,
})
const idsWhere = (rule: (state: WorkflowState) => boolean) =>
  new Set(states.value.filter((state) => rule(state)).map((state) => state.state_id))
const foldable = computed(() => idsWhere(folds.foldable))
const folded = computed(() => idsWhere(folds.folded))
const isFolded = (state: WorkflowState) => folded.value.has(state.state_id)
const canFold = (state: WorkflowState) => foldable.value.has(state.state_id)
/** The tracks of the columns: a folded one is its strip, the rest share the width left. */
const tracks = computed(() =>
  states.value
    .map((state) =>
      folded.value.has(state.state_id) ? `${FOLDED_COLUMN}px` : 'var(--column-width)',
    )
    .join(' '),
)
/** What each item waits on, judged against the whole space so a filtered-out blocker still counts. */
const waiting = computed(() => waitingOn(props.links, props.spaceItems ?? props.items))
const lanes = computed(() =>
  props.grouping === 'none'
    ? []
    : boardLanes({
        filtered: props.filtered,
        grouping: props.grouping,
        projects: props.projects,
        scope: props.scopeItems ?? props.items,
        space: props.spaceItems ?? props.items,
        visible: ordered.value,
      }),
)
const grouped = computed(() => props.grouping !== 'none')
/** Flat, the columns are one row the arrows cross; grouped, each lane is its own. */
const boardRow = computed(() => (grouped.value ? undefined : ''))

/** What the last move did, for a screen reader; a polite live region reads it. */
const announcement = ref('')
const dragging = ref(false)
const root = ref<HTMLElement | null>(null)
/** Flat, the board is its own scroller and its own track; grouped, the lanes size theirs. */
const flatRoot = computed(() => (grouped.value ? null : root.value))
const { columnWidth } = useColumnFit(
  flatRoot,
  flatRoot,
  () => columns.value.length - folded.value.size,
  () => folded.value.size,
)

/** Fold or open a column, and give focus to what undoes it. */
function fold(state: WorkflowState) {
  folds.toggle(state)
  void nextTick(() =>
    root.value?.querySelector<HTMLElement>(`[data-column-fold="${state.state_id}"]`)?.focus(),
  )
}

const nameOf = useStateName()
function stateName(key: string): string {
  const state = props.workflow.states.find((entry) => entry.key === key)
  return state ? nameOf(state) : key
}

function announce(text: string) {
  // Cleared first so the same sentence twice in a row is read twice.
  announcement.value = ''
  void nextTick(() => {
    announcement.value = text
  })
}

function placed(move: BoardMove, landing: StackLanding) {
  announce(
    t('workItem.order.moved', {
      reference: move.reference,
      position: landing.position,
      total: landing.total,
      state: stateName(move.state),
    }),
  )
  emit('place', move)
}
</script>

<template>
  <div
    ref="root"
    class="work-item-board"
    :class="{ dragging, grouped }"
    :data-board-row="boardRow"
    :style="{
      '--column-count': columns.length,
      '--column-width': columnWidth,
      '--board-tracks': tracks,
    }"
  >
    <WorkItemLanes
      v-if="grouped"
      :lanes="lanes"
      :states="states"
      :foldable="foldable"
      :folded="folded"
      :waiting="waiting"
      :live="props.live"
      :filter="props.filter"
      :filtered="props.filtered"
      :hint-id="hintId"
      :space-id="props.spaceId"
      :writable="props.writable"
      @chain="emit('chain', $event)"
      @dragging="dragging = $event"
      @filter="emit('filter', $event)"
      @fold="fold"
      @open="emit('open', $event)"
      @place="placed"
    />
    <template v-else>
      <template
        v-for="column in columns"
        :key="column.state.state_id"
      >
        <WorkItemColumnFold
          v-if="isFolded(column.state)"
          :state="column.state"
          :count="column.items.length"
          @unfold="fold(column.state)"
        />
        <WorkItemColumn
          v-else
          :state="column.state"
          :items="column.items"
          :waiting="waiting"
          :live="props.live"
          :filter="props.filter"
          :hint-id="hintId"
          :writable="props.writable"
          :empty-label="t('workItem.columnEmpty')"
          :foldable="canFold(column.state)"
          @fold="fold(column.state)"
          @dragging="dragging = $event"
          @filter="emit('filter', $event)"
          @open="emit('open', $event)"
          @place="placed"
        />
      </template>
    </template>
    <p
      :id="hintId"
      class="visually-hidden"
    >
      {{ t('workItem.order.hint') }}
    </p>
    <p
      class="visually-hidden"
      role="status"
      aria-live="polite"
    >
      {{ announcement }}
    </p>
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
  --column-width: minmax(208px, 1fr);

  /* One track per column, a folded one at its strip's width: the board says which inline. */
  --board-tracks: repeat(var(--column-count), var(--column-width));

  position: relative;
  display: grid;
  grid-template-columns: var(--board-tracks);
  gap: var(--space-2);
  height: 100%;
  min-height: 0;
  overflow: auto hidden;
  scroll-snap-type: x proximity;

  /* This board owns horizontal scrolling. Paint containment keeps off-screen
     lanes from enlarging the hidden Planning shell while preserving access
     to every lane through this scrollport. */
  contain: paint;

  /* Grouped, the lanes own both scrolls and lay out their own tracks. A lane heading's
     buttons stand at the board's edges, and the edge cut their rings: the board stands a
     ring's reach (2px out, 2px wide: `base.css`) into the gutter at either side, and the
     lanes take it back as padding. */
  &.grouped {
    display: block;
    margin-inline: calc(-1 * var(--space-1));
    overflow: hidden;
  }

  &.dragging {
    cursor: grabbing;
  }
}
</style>
