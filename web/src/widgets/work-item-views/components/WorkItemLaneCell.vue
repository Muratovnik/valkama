<script setup lang="ts">
/**
 * One state of one lane: a ground with the lane's tiles in that state.
 *
 * It is as tall as what it draws, and it draws the first few tiles with the
 * rest one click away. A lane of ninety backlog items used to be ninety tiles
 * tall, and every lane under it that far down the board. The first tiles are
 * the ones the order of work puts next, so they are the ones worth seeing. A
 * tile that lands past what the cell draws, dropped or moved from the keyboard,
 * opens the cell, so the tile is drawn where it went and keeps its focus.
 *
 * A terminal cell (Done, Cancelled) draws none of its tiles: that work is
 * finished, so the cell says how much there is and offers it as a line of text,
 * with no ground under it. A ground holding only that offer stood as tall as a
 * tile in every lane of the board, and a lane of finished work now stands no
 * taller than its open work does.
 *
 * The offer is a disclosure, and it closes as it opens. Opened, the cell grows
 * below where the reader was and focus goes to the first tile it revealed;
 * closed, focus comes back to the toggle, which stays at the end of the cell.
 * Either way focus lands on something drawn, never on the page. The toggle is
 * part of the cell's arrow walk, so an arrow key always leads back to the tiles.
 */
import { computed, nextTick, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import WorkItemStack from '@/widgets/work-item-views/components/WorkItemStack.vue'
import type { StackLanding } from '@/widgets/work-item-views/components/WorkItemStack.vue'
import { clearOfHeading } from '@/widgets/work-item-views/composables/useLaneClearance.ts'
import { drawnInCell } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { LiveWork } from '@/shared/api/liveWorkModel.ts'
import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  filter: WorkFilter
  /** The lane's drop group: a tile crosses between the cells of its lane only. */
  group: string
  items: WorkItemBrief[]
  /** A tile of this lane is being dragged, so this cell can take it. */
  landable: boolean
  /** What an agent's session is doing on each item with live work, by item id. */
  live: Readonly<Record<string, LiveWork>>
  /** A move has landed in this cell while it was closed, so it is drawn whole. */
  revealed: boolean
  state: WorkflowState
  waiting: Map<string, string>
  writable: boolean
  hintId?: string
}>()

const emit = defineEmits<{
  /** The reader closed the cell, which takes back a landing that opened it. */
  collapse: []
  dragging: [active: boolean]
  edge: [reference: string, edge: 'first' | 'last']
  filter: [token: WorkFilterToken]
  open: [reference: string]
  place: [move: BoardMove, landing: StackLanding]
}>()

const { t } = useI18n()
const stackId = useId()

const cell = ref<HTMLElement | null>(null)
const stack = ref<InstanceType<typeof WorkItemStack> | null>(null)

/** Tiles this cell draws unasked; a terminal cell draws none. */
const drawn = computed(() => drawnInCell(props.state))

/**
 * The operator asked to see the whole cell, for as long as it is drawn. A move
 * that lands past what the cell draws is shown whole by the lanes, which hold it.
 */
const whole = ref(false)
const showWhole = computed(() => whole.value || props.revealed)
const limit = computed(() => (showWhole.value ? undefined : drawn.value))
/** The cell holds more than it draws, so it offers the rest, or offers to put it away again. */
const offered = computed(() => props.items.length > drawn.value)
/** Nothing of the cell is drawn yet, so at rest it has no ground to lay anything on. */
const bare = computed(() => !props.items.length || limit.value === 0)
const toggleLabel = computed(() =>
  showWhole.value
    ? t('workItem.lanes.showFewer')
    : t('workItem.lanes.showAll', { count: props.items.length }),
)

function toggleButton(): HTMLElement | null {
  return cell.value?.querySelector<HTMLElement>(':scope > .lane-more') ?? null
}

async function flip() {
  if (showWhole.value) {
    whole.value = false
    emit('collapse')
    await nextTick()
    const button = toggleButton()
    // The toggle keeps its element while the cell shrinks above it, so focusing
    // it again scrolls nothing; it is brought back into view here.
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest' })
    if (button) clearOfHeading(button)
    return
  }
  whole.value = true
  await nextTick()
  stack.value?.focusAt(drawn.value)
}

function walk(event: KeyboardEvent) {
  stack.value?.walkFrom(event, toggleButton())
}
</script>

<template>
  <div
    ref="cell"
    class="lane-cell"
    :class="{ empty: !props.items.length, bare, landable: props.landable }"
    :data-state="props.state.key"
  >
    <WorkItemStack
      :id="stackId"
      ref="stack"
      class="lane-stack"
      :group="props.group"
      :state="props.state"
      :items="props.items"
      :limit="limit"
      :waiting="props.waiting"
      :live="props.live"
      :filter="props.filter"
      :hint-id="props.hintId"
      :writable="props.writable"
      @dragging="emit('dragging', $event)"
      @edge="(reference, edge) => emit('edge', reference, edge)"
      @filter="emit('filter', $event)"
      @open="emit('open', $event)"
      @place="(move, landing) => emit('place', move, landing)"
    />
    <VButton
      v-if="offered"
      class="lane-more"
      variant="text"
      size="inline"
      :aria-expanded="showWhole"
      :aria-controls="stackId"
      @click="flip"
      @keydown="walk"
      >{{ toggleLabel }}</VButton
    >
  </div>
</template>

<style scoped>
/* A ground like a column's. A cell with no tile drawn keeps its place, so a tile
   can still be dropped there, but takes no ground and no floor until a tile of its
   lane is dragged and could land in it: at rest a row of epics drew five grey
   boxes for every lane, the loudest thing on a board of mostly empty cells. */
.lane-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-2);
  background: var(--color-surface);
  border-radius: var(--radius-card);

  /* A forced palette clears the ground, so a cell that has one takes an edge instead. */
  @media (forced-colors: active) {
    border: 1px solid currentcolor;
  }

  &.bare:not(.landable) {
    gap: 0;
    background: none;

    /* It keeps the border's room in the ground's colour, so a drag that makes it a landing
       moves nothing inside it. */
    @media (forced-colors: active) {
      border-color: Canvas;
    }

    .lane-stack {
      min-height: 0;
    }
  }
}

.lane-stack {
  flex: 1 0 auto;
}

.lane-more {
  align-self: start;
}
</style>
