<script setup lang="ts">
/**
 * The tiles of one state, in the order of work, and the two ways to change it.
 *
 * A drag and a keystroke end the same way: as a move naming the state the tile
 * goes to and where it lands among that state's tiles, which the board hands
 * up. Neither changes what is drawn here. The drop library moves the element it
 * dragged, and a list Vue rendered must not be rearranged under it, so the
 * element goes back where it came from the moment the drop is read; the tile
 * moves when the move comes back down as data. A refused move therefore needs
 * nothing undone, which is what the old drop got wrong: it left the tile in the
 * column the server had just refused.
 *
 * Alt+↑ and Alt+↓ move a focused tile one place up or down its stack, for a
 * reader without a pointer. Several stacks share one `group` when a tile may
 * cross between them — the columns of a board, or the cells of one lane.
 */
import { ref, watch } from 'vue'

import { useSortable } from '@vueuse/integrations/useSortable'
import type { SortableEvent } from 'sortablejs'

import WorkItemTile from '@/widgets/work-item-views/components/WorkItemTile.vue'
import { rankBeside } from '@/widgets/work-item-views/utils/boardOrder.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'

/** Where a move left the tile, for the sentence that announces it. */
export interface StackLanding {
  keyboard: boolean
  position: number
  total: number
}

const props = defineProps<{
  blockedIds: Set<string>
  /** Stacks a tile may move between share this name. */
  group: string
  items: WorkItemBrief[]
  readyIds: Set<string>
  state: WorkflowState
  writable: boolean
  /** The element a keyboard hint is read from, or nothing when no move is possible. */
  hintId?: string
}>()

const emit = defineEmits<{
  dragging: [active: boolean]
  edge: [reference: string, edge: 'first' | 'last']
  open: [reference: string]
  place: [move: BoardMove, landing: StackLanding]
}>()

const list = ref<HTMLElement | null>(null)
let droppedAt = 0

const isReady = (item: WorkItemBrief) => props.readyIds.has(item.work_item_id)
const isBlocked = (item: WorkItemBrief) => props.blockedIds.has(item.work_item_id)

/** The reference of the nearest tile beside `element` in one direction. */
function beside(element: Element, direction: 'next' | 'previous'): string | undefined {
  let current = direction === 'next' ? element.nextElementSibling : element.previousElementSibling
  while (current !== null) {
    const reference = (current as HTMLElement).dataset.reference
    if (reference) return reference
    current = direction === 'next' ? current.nextElementSibling : current.previousElementSibling
  }
  return undefined
}

function dropped(event: SortableEvent) {
  emit('dragging', false)
  droppedAt = Date.now()
  const { from, item, to } = event
  const oldIndex = event.oldIndex ?? 0
  const reference = item.dataset.reference
  const state = to.dataset.state
  const moved = from !== to || oldIndex !== event.newIndex
  const rank = rankBeside(beside(item, 'previous'), beside(item, 'next'))
  const landing = {
    keyboard: false,
    position: (event.newIndex ?? 0) + 1,
    total: to.children.length,
  }
  // Back where Vue put it; the move is drawn from the data that comes back.
  item.remove()
  from.insertBefore(item, from.children[oldIndex] ?? null)
  if (moved && reference && state) emit('place', { reference, state, rank }, landing)
}

const sortable = useSortable(list, [], {
  group: props.group,
  animation: 150,
  disabled: !props.writable,
  // The pointer's own copy of the tile, drawn by the page rather than the
  // platform, so it looks the same in every engine and stays on top of a
  // column that clips its overflow.
  forceFallback: true,
  fallbackOnBody: true,
  onStart: () => emit('dragging', true),
  onEnd: dropped,
  onUpdate() {
    // The integration's default reorders the array it was handed and the DOM
    // with it; this stack orders neither, so the default is replaced by nothing.
  },
})
watch(
  () => props.writable,
  (writable) => sortable.option('disabled', !writable),
)
watch(
  () => props.group,
  (group) => sortable.option('group', group),
)

/** A click that lands within a quarter second of a drop was the drop. */
function open(reference: string) {
  if (Date.now() - droppedAt > 250) emit('open', reference)
}

const STEPS: Record<string, -1 | 1> = { ArrowDown: 1, ArrowUp: -1 }

function stepped(event: KeyboardEvent, index: number) {
  const step = STEPS[event.key]
  if (!props.writable || step === undefined || !event.altKey) return
  if (event.ctrlKey || event.metaKey || event.shiftKey) return
  event.preventDefault()
  const item = props.items[index]
  const neighbour = props.items[index + step] as WorkItemBrief | undefined
  if (neighbour === undefined) {
    emit('edge', item.reference, step < 0 ? 'first' : 'last')
    return
  }
  const where = step < 0 ? 'before' : 'after'
  emit(
    'place',
    { reference: item.reference, state: props.state.key, rank: `${where}:${neighbour.reference}` },
    { keyboard: true, position: index + step + 1, total: props.items.length },
  )
}

/** What a tile says it answers to, only where it can answer. */
const shortcuts = 'Alt+ArrowUp Alt+ArrowDown'
function keyHint(): string | undefined {
  return props.writable ? shortcuts : undefined
}
</script>

<template>
  <ul
    ref="list"
    class="work-item-stack"
    :data-state="props.state.key"
  >
    <li
      v-for="(item, index) in props.items"
      :key="item.work_item_id"
      :data-reference="item.reference"
    >
      <WorkItemTile
        :item="item"
        :ready="isReady(item)"
        :blocked="isBlocked(item)"
        :aria-keyshortcuts="keyHint()"
        :aria-describedby="props.hintId"
        @keydown="stepped($event, index)"
        @open="open"
      />
    </li>
  </ul>
</template>

<style scoped>
/* The space between two sheets belongs to the stack, so it is a gap and is
   never spent after the last one. The floor is a drop target's height, so an
   empty stack can still take a tile. */
.work-item-stack {
  display: grid;
  gap: var(--space-2);
  align-content: start;
  min-height: 18px;
  padding: 0;
  margin: 0;
  list-style: none;
}
</style>
