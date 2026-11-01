<script setup lang="ts">
/**
 * Kanban: one column per workflow state, over the same model the list and the
 * graph read — or, grouped by epic, one lane of those columns per epic.
 *
 * The columns come from `workflow.states`, in the order the workflow gives
 * them, the terminal states last. Nothing here knows there are six, or that one
 * of them is called Dev.
 * A state's tiles arrive in the order of work, and moving one — by drag, or by
 * Alt+↑/↓ on a focused tile — is handed up as the state it goes to and where it
 * lands, for the page to send. What the move did is said aloud here, because a
 * reader who moved a tile without looking needs to hear where it went.
 *
 * Grouped by epic, a lane shows only its own tiles of a state, but the order
 * it changes is the state's across the whole board: a tile moved above its
 * lane neighbour moves past every other lane's tile between them too. So each
 * reorder made in a lane, by drag or by Alt+↑/↓, shows that in a line at the
 * foot of the board for a few seconds, then lets it go. A screen reader has it
 * from the tiles' description already, so the line is not read twice.
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import WorkItemColumn from '@/widgets/work-item-views/components/WorkItemColumn.vue'
import WorkItemLanes from '@/widgets/work-item-views/components/WorkItemLanes.vue'
import type { StackLanding } from '@/widgets/work-item-views/components/WorkItemStack.vue'
import { useColumnFit } from '@/widgets/work-item-views/composables/useColumnFit.ts'
import { terminalLast } from '@/widgets/work-item-views/utils/boardColumns.ts'
import { boardLanes } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardGrouping } from '@/widgets/work-item-views/utils/boardLanes.ts'
import { newestClosedFirst } from '@/widgets/work-item-views/utils/boardOrder.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import { waitingOn } from '@/entities/work-item/utils/waiting.ts'
import { EMPTY_WORK_FILTER } from '@/entities/work-item/utils/workFilter.ts'
import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import { byState } from '@/shared/api/planningModel.ts'
import type { PlanningEdge, PlanningWorkflow, WorkItemBrief } from '@/shared/api/planningModel.ts'

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
    /** The items the board is scoped to before any filter; `items` when absent. */
    scopeItems?: WorkItemBrief[]
    /** The planning space, which names epics outside the scope and owns the folded lanes. */
    spaceId?: string
    spaceItems?: WorkItemBrief[]
    writable?: boolean
  }>(),
  {
    filter: () => EMPTY_WORK_FILTER,
    filtered: false,
    grouping: 'none',
    scopeItems: undefined,
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
const hintId = `${useId()}-reorder`

/** The items in the order the board draws them: Done newest closed first. */
const ordered = computed(() => newestClosedFirst(props.items))
const columns = computed(() => terminalLast(byState(props.workflow, ordered.value)))
const states = computed(() => columns.value.map((column) => column.state))
/** What each item waits on, judged against the whole space so a filtered-out blocker still counts. */
const waiting = computed(() => waitingOn(props.links, props.spaceItems ?? props.items))
const lanes = computed(() =>
  props.grouping === 'epic'
    ? boardLanes({
        filtered: props.filtered,
        scope: props.scopeItems ?? props.items,
        space: props.spaceItems ?? props.items,
        visible: ordered.value,
      })
    : [],
)
const grouped = computed(() => props.grouping === 'epic')
const hint = computed(() => (props.writable ? hintId : undefined))
/** Flat, the columns are one row the arrows cross; grouped, each lane is its own. */
const boardRow = computed(() => (grouped.value ? undefined : ''))

/** What the last move did, for a screen reader; a polite live region reads it. */
const announcement = ref('')
const dragging = ref(false)
/** The tile a keyboard move should hand focus back to once it is drawn again. */
let refocus: string | null = null
const root = ref<HTMLElement | null>(null)
/** Flat, the board is its own scroller and its own track; grouped, the lanes size theirs. */
const flatRoot = computed(() => (grouped.value ? null : root.value))
const { columnWidth } = useColumnFit(flatRoot, flatRoot, () => columns.value.length)

function stateName(key: string): string {
  return props.workflow.states.find((state) => state.key === key)?.name ?? key
}

function announce(text: string) {
  // Cleared first so the same sentence twice in a row is read twice.
  announcement.value = ''
  void nextTick(() => {
    announcement.value = text
  })
}

/** How long the shared-order line stays after a reorder in a lane. */
const NOTE_MS = 6000
const sharedOrder = ref(false)
let noteTimer: ReturnType<typeof setTimeout> | undefined

function showSharedOrder() {
  sharedOrder.value = true
  clearTimeout(noteTimer)
  noteTimer = setTimeout(() => {
    sharedOrder.value = false
  }, NOTE_MS)
}
onBeforeUnmount(() => clearTimeout(noteTimer))

function placed(move: BoardMove, landing: StackLanding) {
  if (grouped.value) showSharedOrder()
  if (landing.keyboard) refocus = move.reference
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

function edge(reference: string, which: 'first' | 'last') {
  announce(t(`workItem.order.${which}`, { reference }))
}

watch(
  () => props.items,
  async () => {
    if (refocus === null) return
    const wanted = refocus
    refocus = null
    await nextTick()
    const tile = [...(root.value?.querySelectorAll<HTMLElement>('[data-reference]') ?? [])].find(
      (element) => element.dataset.reference === wanted,
    )
    const button = tile?.querySelector<HTMLElement>('.tile-open')
    // The tile keeps its element across the move, so it is often still focused
    // and focusing it again would scroll nothing; it is brought into view here.
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  },
  { flush: 'post' },
)
</script>

<template>
  <div
    ref="root"
    class="work-item-board"
    :class="{ dragging, grouped, noting: sharedOrder }"
    :data-board-row="boardRow"
    :style="{ '--column-count': columns.length, '--column-width': columnWidth }"
  >
    <WorkItemLanes
      v-if="grouped"
      :lanes="lanes"
      :states="states"
      :waiting="waiting"
      :filter="props.filter"
      :filtered="props.filtered"
      :hint-id="hint"
      :space-id="props.spaceId"
      :writable="props.writable"
      @chain="emit('chain', $event)"
      @dragging="dragging = $event"
      @edge="edge"
      @filter="emit('filter', $event)"
      @open="emit('open', $event)"
      @place="placed"
    />
    <template v-else>
      <WorkItemColumn
        v-for="column in columns"
        :key="column.state.state_id"
        :state="column.state"
        :items="column.items"
        :waiting="waiting"
        :filter="props.filter"
        :hint-id="hint"
        :writable="props.writable"
        :empty-label="t('workItem.columnEmpty')"
        @dragging="dragging = $event"
        @edge="edge"
        @filter="emit('filter', $event)"
        @open="emit('open', $event)"
        @place="placed"
      />
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
    <p
      v-if="grouped"
      class="board-order-note"
      aria-hidden="true"
      :class="{ shown: sharedOrder }"
    >
      {{ t('workItem.order.shared') }}
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

  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--column-count), var(--column-width));
  gap: var(--space-2);
  height: 100%;
  min-height: 0;
  overflow: auto hidden;
  scroll-snap-type: x proximity;

  /* This board owns horizontal scrolling. Paint containment keeps off-screen
     lanes from enlarging the hidden Planning shell while preserving access
     to every lane through this scrollport. */
  contain: paint;

  /* Grouped, the lanes own both scrolls and lay out their own tracks. */
  &.grouped {
    display: block;
    overflow: hidden;
  }

  &.dragging {
    cursor: grabbing;
  }

  /* While the shared-order line is up, a tile moved to the foot of a lane is
     brought into view above the line rather than under it. The lanes read this
     as the bottom of their scroll padding. */
  &.noting {
    --board-note-reach: calc(var(--size-control-height) + var(--space-4) + var(--space-2));
  }
}

/* A floating line over the foot of the board: the overlay hairline and shadow
   keep it off the tiles it lies over, and it takes no pointer, so a drop or a
   click below it lands on the board. */
.board-order-note {
  position: absolute;
  right: 0;
  bottom: var(--space-4);
  left: 0;
  z-index: 3;
  width: fit-content;
  max-width: calc(100% - 2 * var(--space-4));
  padding: var(--space-2) var(--space-3);
  margin: 0 auto;
  border: 1px solid var(--color-rule-strong);
  color: var(--color-text);
  font: var(--font-detail);
  background: var(--color-surface);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-overlay);
  opacity: 0;
  transition: opacity var(--duration-surface) var(--ease-out);
  pointer-events: none;

  &.shown {
    opacity: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
  }
}
</style>
