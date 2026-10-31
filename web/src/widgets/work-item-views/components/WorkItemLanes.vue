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
 */
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import WorkItemStack from '@/widgets/work-item-views/components/WorkItemStack.vue'
import type { StackLanding } from '@/widgets/work-item-views/components/WorkItemStack.vue'
import { useLaneCollapse } from '@/widgets/work-item-views/composables/useLaneCollapse.ts'
import type { BoardLane } from '@/widgets/work-item-views/utils/boardLanes.ts'
import type { BoardMove } from '@/widgets/work-item-views/utils/boardOrder.ts'

import type { WorkflowState, WorkItemBrief } from '@/shared/api/planningModel.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  blockedIds: Set<string>
  /** A queue or search filter is narrowing what the lanes draw. */
  filtered: boolean
  lanes: BoardLane[]
  readyIds: Set<string>
  /** Whose folded lanes these are: the planning space. */
  spaceId: string
  states: WorkflowState[]
  writable: boolean
  hintId?: string
}>()

const emit = defineEmits<{
  chain: [reference: string]
  dragging: [active: boolean]
  edge: [reference: string, edge: 'first' | 'last']
  open: [reference: string]
  place: [move: BoardMove, landing: StackLanding]
}>()

const { t } = useI18n()
const prefix = useId()
const { folded, toggle } = useLaneCollapse(() => props.spaceId)

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

function chevron(lane: BoardLane): 'chevron-down' | 'chevron-right' {
  return isFolded(lane) ? 'chevron-right' : 'chevron-down'
}

function title(lane: BoardLane): string {
  return lane.epic?.title ?? t('workItem.lanes.noEpic')
}

function counts(lane: BoardLane): string {
  return t('workItem.lanes.counts', { open: lane.open, closed: lane.closed })
}

function inState(lane: BoardLane, state: WorkflowState): WorkItemBrief[] {
  return lane.items.filter((item) => item.state.state_id === state.state_id)
}

function isEmpty(lane: BoardLane): boolean {
  return lane.open + lane.closed === 0
}

function laneGroup(lane: BoardLane): string {
  return `lane:${lane.id}`
}

function openEpic(lane: BoardLane) {
  if (lane.epic) emit('open', lane.epic.reference)
}

function showChain(lane: BoardLane) {
  if (lane.epic) emit('chain', lane.epic.reference)
}

function toggleLabel(lane: BoardLane): string {
  return t(isFolded(lane) ? 'workItem.lanes.unfold' : 'workItem.lanes.fold', {
    lane: title(lane),
  })
}
</script>

<template>
  <div
    class="work-item-lanes"
    :style="{ '--column-count': props.states.length }"
  >
    <div class="lanes-track">
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
        :aria-label="title(lane)"
        :data-lane="lane.id"
      >
        <header class="lane-head">
          <button
            class="lane-toggle"
            type="button"
            :aria-expanded="isOpen(lane)"
            :aria-controls="bodyId(lane)"
            :aria-label="toggleLabel(lane)"
            @click="toggle(lane, props.filtered)"
          >
            <VIcon
              class="lane-chevron"
              :name="chevron(lane)"
              :size="16"
            />
            <span
              v-if="lane.epic"
              class="lane-reference"
              >{{ lane.epic.reference }}</span
            >
            <span class="lane-title">{{ title(lane) }}</span>
          </button>
          <SemanticState
            v-if="lane.epic"
            class="lane-state"
            dimension="work-item-state"
            :state="lane.epic.state.category"
            :label="lane.epic.state.name"
          />
          <span class="lane-counts">{{ counts(lane) }}</span>
          <span
            v-if="lane.epic"
            class="lane-actions"
          >
            <VButton
              variant="ghost"
              size="inline"
              :aria-label="t('workItem.lanes.openEpic', { reference: lane.epic.reference })"
              @click="openEpic(lane)"
              >{{ t('workItem.lanes.open') }}</VButton
            >
            <VButton
              variant="ghost"
              size="inline"
              :aria-label="t('workItem.lanes.showChain', { reference: lane.epic.reference })"
              @click="showChain(lane)"
              >{{ t('workItem.lanes.chain') }}</VButton
            >
          </span>
        </header>
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
          >
            <div
              v-for="state in props.states"
              :key="state.state_id"
              class="lane-cell"
              :data-state="state.key"
            >
              <WorkItemStack
                class="lane-stack"
                :group="laneGroup(lane)"
                :state="state"
                :items="inState(lane, state)"
                :ready-ids="props.readyIds"
                :blocked-ids="props.blockedIds"
                :hint-id="props.hintId"
                :writable="props.writable"
                @dragging="emit('dragging', $event)"
                @edge="(reference, edge) => emit('edge', reference, edge)"
                @open="emit('open', $event)"
                @place="(move, landing) => emit('place', move, landing)"
              />
            </div>
          </div>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* One scroller for both axes: the lanes stack downwards and the states run
   sideways, and the header row and each lane heading stay where they are read.
   The scroller is a container so a heading can ask how wide the visible part is. */
.work-item-lanes {
  --column-count: 1;

  height: 100%;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  container: board-lanes / inline-size;
}

/* Every row of the board lays itself on the same tracks, so a state stands at
   one x in every lane. */
.lanes-track {
  display: grid;
  grid-template-columns: repeat(var(--column-count), minmax(250px, 1fr));
  gap: var(--space-2);
  padding-bottom: var(--space-4);
}

.lanes-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  padding: 0 0 var(--space-2);
  background: var(--color-canvas);
}

.lanes-state {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  padding-inline: var(--space-3);
}

.lanes-state-count {
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

/* A lane is its heading and a row of grounds; the space above the next heading
   is what separates two lanes, so nothing is drawn between them. */
.board-lane {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
  row-gap: var(--space-2);
  padding-top: var(--space-3);
}

/* Held at the left edge of what is visible, however far the states scroll.
   One row while it fits, the title giving way first; on a narrow board the
   state, counts and actions take a second row instead of squeezing the title
   down to its reference. */
.lane-head {
  position: sticky;
  left: 0;
  display: flex;
  grid-column: 1 / -1;
  gap: var(--space-1) var(--space-3);
  justify-self: start;
  align-items: center;
  min-width: 0;
  max-width: 100cqi;
}

.lane-toggle {
  display: inline-flex;
  flex: 0 1 auto;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  min-height: var(--size-control-height-compact);
  padding: 0 var(--space-2) 0 var(--space-1);
  border: 0;
  color: var(--color-text);
  text-align: start;
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}

.lane-chevron {
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

.lane-reference {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}

/* The title is what gives way: the reference and the state beside it are
   shorter and say which lane this is. */
.lane-title {
  min-width: 0;
  font: var(--font-row-title);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.lane-state {
  flex: 0 0 auto;
}

.lane-counts {
  flex: 0 0 auto;
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

.lane-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
}

@container board-lanes (width <= 560px) {
  .lane-head {
    flex-wrap: wrap;
  }
}

.lane-quiet {
  grid-column: 1 / -1;
  padding-inline: var(--space-8);
  margin: 0;
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.lane-cells {
  display: grid;
  grid-template-columns: subgrid;
  grid-column: 1 / -1;
}

/* Each state of a lane is a ground like a column's, and as tall as the
   tallest of its row, so an empty one is a place a tile can still be dropped. */
.lane-cell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 72px;
  padding: var(--space-2);
  background: var(--color-surface);
  border-radius: var(--radius-card);
}

.lane-stack {
  flex: 1 0 auto;
}
</style>
