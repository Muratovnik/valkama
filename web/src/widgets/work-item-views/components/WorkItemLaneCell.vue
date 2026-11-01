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
 * finished, so the cell says how much there is and offers it. A lane of finished
 * work therefore stands no taller than its open work does.
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
import { drawnInCell } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'
import VButton from '@/shared/ui/VButton.vue'

const props = defineProps<{
  filter: WorkFilter
  /** The lane's drop group: a tile crosses between the cells of its lane only. */
  group: string
  items: WorkItemBrief[]
  /** A tile of this lane is being dragged, so this cell can take it. */
  landable: boolean
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
    :class="{ empty: !props.items.length, landable: props.landable }"
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
      variant="ghost"
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
/* A ground like a column's. An empty one keeps its place and its height, so a
   tile can still be dropped there, but draws no ground until a tile of its lane
   is dragged and could land in it: at rest a row of epics drew five grey boxes
   for every lane, the loudest thing on a board of mostly empty cells. */
.lane-cell {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
  padding: var(--space-2);
  background: var(--color-surface);
  border-radius: var(--radius-card);

  &.empty:not(.landable) {
    background: none;
  }
}

.lane-stack {
  flex: 1 0 auto;
}

.lane-more {
  align-self: start;
}
</style>
