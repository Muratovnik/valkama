<script setup lang="ts">
/**
 * The board read by epic: a row of state columns per epic, and the states named
 * once above them all.
 *
 * Every lane shares one set of column tracks, so a state stands at the same x in
 * every lane and its name is said once, in a header that stays while the lanes
 * scroll under it. A lane heading stays at the left edge while the board scrolls
 * sideways, because it is what says whose work a row is.
 *
 * A tile moves between the states of its own lane and nowhere else: moving it to
 * another lane would give it another epic, which is an edit of what the work is
 * part of, not of where it stands. Each lane's stacks therefore share a drop
 * group of their own.
 *
 * A lane is as tall as what it holds, not as its fullest state: each cell is its
 * own height and draws only its first few tiles, and an empty one is a low
 * place a tile can still be dropped on, drawn as a ground only while a tile of
 * its lane is dragged. A terminal cell draws none of its tiles, so a lane of
 * finished work is no taller than its open work.
 *
 * A workflow wider than the board leaves some states off to the side, and a
 * lane whose work sits only there read as an empty lane with a blank gap — the
 * gap being the off-screen cell's height. So a lane's heading names the open
 * work it holds out of sight, and on which side: «2 в «Review» →». Finished
 * work is already counted in the heading, so it is named only when nothing of
 * the lane is in view. The heading also stays at the top while its lane passes
 * under the row of state names, so a lane in view always says whose it is.
 */
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import WorkItemLaneCell from '@/widgets/work-item-views/components/WorkItemLaneCell.vue'
import WorkItemLaneHead from '@/widgets/work-item-views/components/WorkItemLaneHead.vue'
import type { StackLanding } from '@/widgets/work-item-views/components/WorkItemStack.vue'
import { useColumnFit } from '@/widgets/work-item-views/composables/useColumnFit.ts'
import { useColumnsInView } from '@/widgets/work-item-views/composables/useColumnsInView.ts'
import { useLandedCells } from '@/widgets/work-item-views/composables/useLandedCells.ts'
import { useLaneCollapse } from '@/widgets/work-item-views/composables/useLaneCollapse.ts'
import { outOfSight } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardLane, HeldIn } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkFilter, WorkFilterToken } from '@/entities/work-item/utils/workFilter.ts'

import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'

const props = defineProps<{
  /** The filter in force, which a tile's chips read. */
  filter: WorkFilter
  /** A queue or search filter is narrowing what the lanes draw. */
  filtered: boolean
  lanes: BoardLane[]
  /** Whose folded lanes these are: the planning space. */
  spaceId: string
  states: WorkflowState[]
  /** Each item's open blocker, by item id. */
  waiting: Map<string, string>
  writable: boolean
  hintId?: string
}>()

const emit = defineEmits<{
  chain: [reference: string]
  dragging: [active: boolean]
  edge: [reference: string, edge: 'first' | 'last']
  filter: [token: WorkFilterToken]
  open: [reference: string]
  place: [move: BoardMove, landing: StackLanding]
}>()

const { t } = useI18n()
const prefix = useId()
const { folded, toggle } = useLaneCollapse(() => props.spaceId)

const { isLanded, land, settle } = useLandedCells(() => props.states)

const scroller = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)
const { columnWidth, measured, visibleWidth } = useColumnFit(
  scroller,
  track,
  () => props.states.length,
)

const inView = useColumnsInView(scroller, measured, () => props.states.length)

/**
 * The lane a tile is being dragged in, if any. Every cell stands as tall as its
 * lane while a drag is under way, and the cells of that lane — the only ones
 * the tile can land in — draw their ground.
 */
const draggingLane = ref<string | null>(null)
const dragging = computed(() => draggingLane.value !== null)

/** Each lane's tiles by state, read once per change rather than once per cell. */
const cells = computed(() => {
  const byLane = new Map<string, Map<string, WorkItemBrief[]>>()
  for (const lane of props.lanes) {
    const byState = new Map<string, WorkItemBrief[]>()
    for (const item of lane.items) {
      const held = byState.get(item.state.state_id)
      if (held === undefined) byState.set(item.state.state_id, [item])
      else held.push(item)
    }
    byLane.set(lane.id, byState)
  }
  return byLane
})

/** What each column holds across the lanes drawn, for the header that names it. */
const stateCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const lane of props.lanes)
    for (const item of lane.items)
      counts.set(item.state.state_id, (counts.get(item.state.state_id) ?? 0) + 1)
  return counts
})

function stateCount(state: WorkflowState): number {
  return stateCounts.value.get(state.state_id) ?? 0
}

function isFolded(lane: BoardLane): boolean {
  return folded(lane, props.filtered)
}

function isOpen(lane: BoardLane): boolean {
  return !isFolded(lane)
}

function bodyId(lane: BoardLane): string {
  return `${prefix}-${lane.id}`
}

function title(lane: BoardLane): string {
  return lane.epic?.title ?? t('workItem.lanes.noEpic')
}

function inState(lane: BoardLane, state: WorkflowState): WorkItemBrief[] {
  return cells.value.get(lane.id)?.get(state.state_id) ?? []
}

/** «2 в «Review», 1 в «Blocked»». */
function heldWords(held: HeldIn<WorkflowState>[]): string {
  return held
    .map(({ count, state }) => t('workItem.lanes.inState', { count, state: state.name }))
    .join(', ')
}

/** Each open lane's work out of sight, to the left and to the right of the states in view. */
const elsewhere = computed(() => {
  const notes = new Map<string, { left: string; right: string }>()
  const first = inView.first.value
  const last = inView.last.value
  if (first === 0 && last === props.states.length - 1) return notes
  for (const lane of props.lanes) {
    if (!isOpen(lane) || isEmpty(lane)) continue
    const { left, right } = outOfSight(
      props.states,
      first,
      last,
      (state) => inState(lane, state).length,
    )
    if (left.length || right.length)
      notes.set(lane.id, { left: heldWords(left), right: heldWords(right) })
  }
  return notes
})

/** What the lane's heading says it holds out of sight on one side; empty when nothing. */
function away(lane: BoardLane, side: 'left' | 'right'): string {
  return elsewhere.value.get(lane.id)?.[side] ?? ''
}

/** Some lane names work out of sight, so some heading may stand two rows tall. */
const anyAway = computed(() => elsewhere.value.size > 0)

function drag(lane: BoardLane, active: boolean) {
  draggingLane.value = active ? lane.id : null
  emit('dragging', active)
}

function isEmpty(lane: BoardLane): boolean {
  return lane.open + lane.closed === 0
}

/** A tile of this lane is being dragged, so its cells can take it. */
function isLanding(lane: BoardLane): boolean {
  return draggingLane.value === lane.id
}

function laneGroup(lane: BoardLane): string {
  return `lane:${lane.id}`
}
</script>

<template>
  <div
    ref="scroller"
    class="work-item-lanes"
    :class="{ dragging, away: anyAway }"
    :style="{
      '--column-count': props.states.length,
      '--column-width': columnWidth,
      '--board-visible-width': visibleWidth,
    }"
  >
    <div
      ref="track"
      class="lanes-track"
    >
      <div
        class="lanes-head"
        aria-hidden="true"
      >
        <span
          v-for="state in props.states"
          :key="state.state_id"
          class="lanes-state"
        >
          <SemanticState
            dimension="work-item-state"
            :state="state.category"
            :label="state.name"
          />
          <span class="lanes-state-count">{{ stateCount(state) }}</span>
        </span>
      </div>
      <section
        v-for="lane in props.lanes"
        :key="lane.id"
        class="board-lane"
        :class="{ open: isOpen(lane) }"
        :aria-label="title(lane)"
        :data-lane="lane.id"
      >
        <WorkItemLaneHead
          :lane="lane"
          :open="isOpen(lane)"
          :body-id="bodyId(lane)"
          :left="away(lane, 'left')"
          :right="away(lane, 'right')"
          @toggle="toggle(lane, props.filtered)"
          @open="emit('open', $event)"
          @chain="emit('chain', $event)"
        />
        <template v-if="isOpen(lane)">
          <p
            v-if="isEmpty(lane)"
            :id="bodyId(lane)"
            class="lane-quiet"
          >
            {{ t('workItem.lanes.empty') }}
          </p>
          <div
            v-else
            :id="bodyId(lane)"
            class="lane-cells"
            data-board-row
          >
            <WorkItemLaneCell
              v-for="state in props.states"
              :key="state.state_id"
              :group="laneGroup(lane)"
              :state="state"
              :items="inState(lane, state)"
              :waiting="props.waiting"
              :filter="props.filter"
              :hint-id="props.hintId"
              :landable="isLanding(lane)"
              :revealed="isLanded(lane, state)"
              :writable="props.writable"
              @collapse="settle(lane, state)"
              @dragging="(active) => drag(lane, active)"
              @edge="(reference, edge) => emit('edge', reference, edge)"
              @filter="emit('filter', $event)"
              @open="emit('open', $event)"
              @place="(move, landing) => (land(lane, move, landing), emit('place', move, landing))"
            />
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* One scroller for both axes: the lanes stack downwards and the states run
   sideways, and the header row and each lane heading stay where they are read.
   The visible width a heading is held to is measured, because a container
   query counts the vertical scrollbar in and cut the heading's last action by
   the bar's width; the container stays for the fallback and the narrow wrap. */
.work-item-lanes {
  --column-count: 1;
  --column-width: minmax(208px, 1fr);

  /* What a lane heading is held to until the scroller has been measured. */
  --board-visible-width: 100cqi;

  /* One track list for the header row and every lane. */
  --lane-tracks: repeat(var(--column-count), var(--column-width));

  /* The row of state names, and how tall a lane heading held under it while
     its lane passes stands: one compact control each, two rows for a heading
     that wraps on a narrow board. */
  --lanes-head-block: var(--size-control-height-compact);
  --lane-head-block: var(--size-control-height-compact);

  height: 100%;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;

  /* A tile focused or brought into view stops below the sticky row of state
     names and the lane heading held under it rather than under them, and
     short of the bottom edge by more than its focus ring reaches — or, while
     the board shows its shared-order line there, above that line. */
  scroll-padding-block: calc(var(--lanes-head-block) + var(--lane-head-block) + var(--space-2))
    var(--board-note-reach, var(--space-2));
  scroll-snap-type: x proximity;
  container: board-lanes / inline-size;
}

/* Every row of the board lays itself on the same tracks, so a state stands at
   one x in every lane. */
.lanes-track {
  display: grid;
  grid-template-columns: var(--lane-tracks);
  gap: var(--space-2);
  padding-bottom: var(--space-4);
}

.lanes-head {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  min-height: var(--lanes-head-block);
  padding: 0 0 var(--space-2);
  background: var(--color-canvas);
}

.lanes-state {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding-inline: var(--space-3);
  scroll-snap-align: start;
}

.lanes-state-count {
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

/* A lane is its heading and a row of grounds; the space above the next heading
   is what separates two lanes, so nothing is drawn between them. */

/* A lane repeats the tracks rather than borrowing them as a subgrid: the tracks
   are measured widths, so they line up the same, and a lane that stands on its
   own can skip layout while it is scrolled out of sight. Laying out every lane
   of a space was most of what regrouping the board cost.

   A lane not yet laid out is reserved its likely height, a folded one its
   heading's: a single guess for both made the scrollbar of a space with a
   hundred folded lanes half again too long until it had been scrolled through. */
.board-lane {
  display: grid;
  grid-template-columns: var(--lane-tracks);
  grid-column: 1 / -1;
  gap: var(--space-2);
  padding-top: var(--space-3);
  contain-intrinsic-size: auto calc(var(--size-control-height-compact) + var(--space-3));
  content-visibility: auto;

  /* An open lane is a block of tiles, and only more air above its heading than
     under it says whose they are. Folded ones are lines of one list. */
  &.open {
    padding-top: var(--space-6);
    contain-intrinsic-size: auto 480px;
  }
}

/* A heading of two rows — a narrow board's, or one naming work out of sight —
   stands that tall under the state names, so a tile brought into view stops
   below both. The scroller cannot query itself, so the workspace it fills is
   asked for the narrow case. */
.work-item-lanes.away {
  --lane-head-block: calc(var(--size-control-height-compact) * 2 + var(--space-1));
}

@container workspace (width <= 600px) {
  .work-item-lanes {
    --lane-head-block: calc(var(--size-control-height-compact) * 2 + var(--space-1));
  }
}

.lane-quiet {
  grid-column: 1 / -1;
  padding-inline: var(--space-8);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

/* Each cell is as tall as its own tiles, so a lane of one card is one card
   tall. While a tile is dragged every cell stretches to its lane, so an empty
   state is a whole lane's height to drop on rather than a strip. */
.lane-cells {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  align-items: start;

  .dragging & {
    align-items: stretch;
  }
}
</style>
