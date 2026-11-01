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
 *
 * Without Alt the arrows only move focus. A stack is one Tab stop — the tile
 * last focused in it — so a board of a thousand tiles is a handful of stops,
 * not a thousand; ↑ and ↓ walk the stack, Home and End go to its ends, and ←
 * and → go to the nearest stack beside it that holds a tile, in the same row of
 * the board: the next column, or the next cell of the same lane. A lane cell's
 * Show all toggle is the last step of its stack's walk, so it is reached like a
 * tile and the arrows lead from it back to the tiles.
 *
 * A stack may draw only its first `limit` tiles. It still reads every item, so
 * a move from the keyboard names its true neighbour and its true end.
 *
 * The completed state's stack is ordered by when its items closed, not by
 * hand, so it offers no reorder: a tile does not move within it by drag or by
 * Alt+↑/↓, and a tile dropped on it from another stack is sent with no place,
 * since the newest close leads whatever place the drop measured.
 */
import { computed, ref, watch } from 'vue'

import { useSortable } from '@vueuse/integrations/useSortable'
import type { SortableEvent } from 'sortablejs'

import WorkItemTile from '@/widgets/work-item-views/components/WorkItemTile.vue'
import { ordersByClosing, rankBeside } from '@/widgets/work-item-views/utils/boardOrder.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'

/** Where a move left the tile, for the sentence that announces it. */
export interface StackLanding {
  keyboard: boolean
  position: number
  total: number
}

const props = defineProps<{
  /** The filter in force, which a tile's chips read. */
  filter: WorkFilter
  /** Stacks a tile may move between share this name. */
  group: string
  items: WorkItemBrief[]
  state: WorkflowState
  /** Each item's open blocker, by item id. */
  waiting: Map<string, string>
  writable: boolean
  /** The element a keyboard hint is read from, or nothing when no move is possible. */
  hintId?: string
  /** Draw only this many tiles; every item is still read. */
  limit?: number
}>()

const emit = defineEmits<{
  dragging: [active: boolean]
  edge: [reference: string, edge: 'first' | 'last']
  filter: [token: WorkFilterToken]
  open: [reference: string]
  place: [move: BoardMove, landing: StackLanding]
}>()

const list = ref<HTMLElement | null>(null)
let droppedAt = 0
/** Whether a tile may be placed by hand among this stack's tiles. */
const reorderable = computed(() => !ordersByClosing(props.state))
/** What the stack says of its order, which a drop into it reads. */
const order = computed(() => (reorderable.value ? undefined : 'closing'))
/** The reorder hint a tile is described by, only where it can be reordered. */
const tileHint = computed(() => (reorderable.value ? props.hintId : undefined))

const shown = computed(() =>
  props.limit === undefined ? props.items : props.items.slice(0, props.limit),
)
/**
 * The item whose tile is this stack's Tab stop: the one last focused while it is
 * still drawn here, otherwise the first. Held by item rather than by place, so
 * the stop moves with a tile Alt+↓ moved.
 */
const active = ref<string | null>(null)
const stop = computed(() => {
  const held = shown.value.some((item) => item.work_item_id === active.value)
  return held ? active.value : (shown.value[0]?.work_item_id ?? null)
})

const waitingOn = (item: WorkItemBrief) => props.waiting.get(item.work_item_id) ?? null

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
  const closing = to.dataset.order === 'closing'
  const rank = closing ? undefined : rankBeside(beside(item, 'previous'), beside(item, 'next'))
  const landing = {
    keyboard: false,
    position: closing ? 1 : (event.newIndex ?? 0) + 1,
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
  sort: !ordersByClosing(props.state),
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
watch(reorderable, (sort) => sortable.option('sort', sort))

/** A click that lands within a quarter second of a drop was the drop. */
function open(reference: string) {
  if (Date.now() - droppedAt > 250) emit('open', reference)
}

function tabStop(item: WorkItemBrief): 0 | -1 {
  return item.work_item_id === stop.value ? 0 : -1
}

const STEPS: Record<string, -1 | 1> = { ArrowDown: 1, ArrowUp: -1 }

/** The tiles a stack draws, as the open targets focus lands on. */
function tilesOf(stack: Element): HTMLElement[] {
  return [...stack.querySelectorAll<HTMLElement>(':scope > li .tile-open')]
}

/**
 * What an arrow walks through in a stack: its tiles, then its cell's Show all
 * toggle when it has one, so a closed cell is still reached and an open one can
 * be closed from the keyboard without leaving the walk.
 */
function walkOf(stack: Element): HTMLElement[] {
  const tiles = tilesOf(stack)
  const more = stack.parentElement?.querySelector<HTMLElement>(':scope > .lane-more')
  return more ? [...tiles, more] : tiles
}

/** The tile at `index`, or the last one, in the nearest stack of this row that has any. */
function across(step: -1 | 1, index: number): HTMLElement | undefined {
  const own = list.value
  const row = own?.closest('[data-board-row]')
  if (!own || !row) return undefined
  const stacks = [...row.querySelectorAll('.work-item-stack')].filter(
    (stack) => stack.closest('[data-board-row]') === row,
  )
  for (let at = stacks.indexOf(own) + step; at >= 0 && at < stacks.length; at += step) {
    const tiles = walkOf(stacks[at])
    if (tiles.length) return tiles[Math.min(index, tiles.length - 1)]
  }
  return undefined
}

const WALKS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'])

/** Where a bare arrow, Home or End sends focus from the tile at `index`. */
function target(key: string, index: number): HTMLElement | undefined {
  const own = list.value === null ? [] : walkOf(list.value)
  if (key === 'ArrowUp') return own[index - 1]
  if (key === 'ArrowDown') return own[index + 1]
  if (key === 'Home') return own[0]
  if (key === 'End') return own.at(-1)
  return across(key === 'ArrowLeft' ? -1 : 1, index)
}

/**
 * A walk past the last tile stays where it is. It does not fall through to the
 * scroller either, which would slide the focused tile away from the reader.
 */
function walked(event: KeyboardEvent, index: number) {
  if (!WALKS.has(event.key) || event.ctrlKey || event.metaKey || event.shiftKey) return
  event.preventDefault()
  target(event.key, index)?.focus()
}

/** Focus the tile drawn at `index`, as the cell does with the first one it reveals. */
function focusAt(index: number) {
  if (list.value !== null) tilesOf(list.value)[index]?.focus()
}

/** A walk that starts on the cell's toggle rather than on a tile; Alt moves nothing from there. */
function walkFrom(event: KeyboardEvent, from: HTMLElement | null) {
  if (event.altKey || list.value === null || from === null) return
  const index = walkOf(list.value).indexOf(from)
  if (index >= 0) walked(event, index)
}

function stepped(event: KeyboardEvent, index: number) {
  const step = STEPS[event.key]
  if (!event.altKey) {
    walked(event, index)
    return
  }
  if (!props.writable || !reorderable.value || step === undefined) return
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
  return props.writable && reorderable.value ? shortcuts : undefined
}

defineExpose({ focusAt, walkFrom })
</script>

<template>
  <ul
    ref="list"
    class="work-item-stack"
    :data-state="props.state.key"
    :data-order="order"
  >
    <li
      v-for="(item, index) in shown"
      :key="item.work_item_id"
      class="stack-item"
      :data-reference="item.reference"
      @focusin="active = item.work_item_id"
    >
      <WorkItemTile
        :item="item"
        :waiting-on="waitingOn(item)"
        :filter="props.filter"
        :tab-stop="tabStop(item)"
        :key-shortcuts="keyHint()"
        :hint-id="tileHint"
        @keydown="stepped($event, index)"
        @filter="emit('filter', $event)"
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

/* A sheet scrolled out of its column's sight is not laid out until it is
   reached, as a lane of the grouped board is not: a column draws thirty tiles
   and a screen shows six or seven. It keeps the height it last had, and before
   it has had one, a tile's usual height. */
.stack-item {
  contain-intrinsic-size: auto 120px;
  content-visibility: auto;
}
</style>
