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
 */
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import WorkItemColumn from '@/widgets/work-item-views/components/WorkItemColumn.vue'
import WorkItemLanes from '@/widgets/work-item-views/components/WorkItemLanes.vue'
import type { StackLanding } from '@/widgets/work-item-views/components/WorkItemStack.vue'
import { useColumnFit } from '@/widgets/work-item-views/composables/useColumnFit.ts'
import { terminalLast } from '@/widgets/work-item-views/utils/boardColumns.ts'
import { boardLanes } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardGrouping } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import { byState, readyIds } from '@/shared/api/planningModel.ts'
import type { PlanningEdge, PlanningWorkflow, WorkItemBrief } from '@/shared/api/planningModel.ts'

const props = withDefaults(
  defineProps<{
    items: WorkItemBrief[]
    links: PlanningEdge[]
    workflow: PlanningWorkflow
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
  open: [reference: string]
  place: [move: BoardMove]
}>()

const { t } = useI18n()
const hintId = `${useId()}-reorder`

const columns = computed(() => terminalLast(byState(props.workflow, props.items)))
const states = computed(() => columns.value.map((column) => column.state))
const ready = computed(() => readyIds(props.items))
const blocked = computed(() => {
  const open = new Set(
    (props.spaceItems ?? props.items)
      .filter((item) => !item.state.is_terminal)
      .map((item) => item.work_item_id),
  )
  return new Set(
    props.links
      .filter((link) => link.kind === 'blocks' && open.has(link.from))
      .map((link) => link.to),
  )
})
const lanes = computed(() =>
  props.grouping === 'epic'
    ? boardLanes({
        filtered: props.filtered,
        scope: props.scopeItems ?? props.items,
        space: props.spaceItems ?? props.items,
        visible: props.items,
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

function placed(move: BoardMove, landing: StackLanding) {
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
    const button = tile?.querySelector<HTMLElement>('button')
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
    :class="{ dragging, grouped }"
    :data-board-row="boardRow"
    :style="{ '--column-count': columns.length, '--column-width': columnWidth }"
  >
    <WorkItemLanes
      v-if="grouped"
      :lanes="lanes"
      :states="states"
      :ready-ids="ready"
      :blocked-ids="blocked"
      :filtered="props.filtered"
      :hint-id="hint"
      :space-id="props.spaceId"
      :writable="props.writable"
      @chain="emit('chain', $event)"
      @dragging="dragging = $event"
      @edge="edge"
      @open="emit('open', $event)"
      @place="placed"
    />
    <template v-else>
      <WorkItemColumn
        v-for="column in columns"
        :key="column.state.state_id"
        :state="column.state"
        :items="column.items"
        :ready-ids="ready"
        :blocked-ids="blocked"
        :hint-id="hint"
        :writable="props.writable"
        :empty-label="t('workItem.columnEmpty')"
        @dragging="dragging = $event"
        @edge="edge"
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
}
</style>
