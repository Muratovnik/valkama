<script setup lang="ts">
/**
 * The chain as a branch map: one lane per origin of work, every member one
 * unit along it, and each lane branching off the lane it was discovered from.
 *
 * Read left to right, a lane is finished work, then what is under way, then
 * its grey tail of what is ahead, so its length is its volume. The drawing is
 * one SVG of a handful of paths per lane however many members it has; what the
 * pointer is over is worked out from its x position rather than from a listener
 * per member, and the keyboard reaches the same tasks through one focusable
 * element per lane.
 *
 * Colour is never the only signal: the legend names every state, each lane's
 * counts are text, and the task under the pointer or the keyboard cursor is
 * named in full.
 */
import { computed, ref, useId } from 'vue'

import { useElementSize } from '@vueuse/core'

import ChainBranchTip from '@/widgets/work-item-inspector/components/ChainBranchTip.vue'
import {
  drawBranches,
  markAt,
  tipAt,
} from '@/widgets/work-item-inspector/utils/chainBranchDrawing.ts'
import type { Box, LaneDrawing } from '@/widgets/work-item-inspector/utils/chainBranchDrawing.ts'
import { layoutBranches } from '@/widgets/work-item-inspector/utils/chainBranchLayout.ts'
import { useBranchCursor } from '@/widgets/work-item-inspector/utils/useBranchCursor.ts'
import { useBranchText } from '@/widgets/work-item-inspector/utils/useBranchText.ts'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { statePresentation } from '@/shared/lib/uiSystem.ts'
import SemanticState from '@/shared/ui/SemanticState.vue'

const props = defineProps<{
  chain: WorkItemChain
  /** The lane the member list is narrowed to, by key, or null for every lane. */
  filter: string | null
}>()

const emit = defineEmits<{
  lane: [key: string]
  open: [reference: string]
}>()

const { describe, laneCounts, laneLabel, laneName, legend, position, summary, t } = useBranchText()

const canvas = ref<HTMLElement | null>(null)
const { width: measured } = useElementSize(canvas)
/** Until the element has been measured — and in a test DOM, which never measures — a phone's width. */
const FALLBACK_WIDTH = 342
const width = computed(() => (measured.value > 0 ? measured.value : FALLBACK_WIDTH))

const layout = computed(() => layoutBranches(props.chain))
const drawing = computed(() =>
  drawBranches(layout.value, width.value, (lane) => ({
    name: laneName(lane),
    counts: laneCounts(lane),
  })),
)

const { announcement, cursorOf, enter, exit, leave, move, openAt, point, shown } = useBranchCursor({
  canvas,
  describe,
  drawing,
  open: (reference) => emit('open', reference),
})

/** The lane the member list is narrowed to says so: it is the current one. */
function isFiltered(lane: LaneDrawing): boolean {
  return props.filter === lane.lane.key
}

function currentOf(lane: LaneDrawing): 'true' | undefined {
  return isFiltered(lane) ? 'true' : undefined
}

/** The parent epic's title, where the lane has one, as the label's tooltip. */
function titleOf(lane: LaneDrawing): string | undefined {
  return lane.lane.title ?? undefined
}

function positionOf(lane: LaneDrawing): string {
  return position(cursorOf(lane.lane), lane.lane.members.length)
}

const caption = computed(() => summary(layout.value.lanes, layout.value.total))

/** A length of the drawing as a style value; an absent one sets nothing. */
function px(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value}px`
}

/** A box of the drawing as a style, in the logical properties the map is laid out by. */
function place(box: Box) {
  return {
    insetBlockStart: px(box.top),
    insetBlockEnd: px(box.bottom),
    insetInlineStart: px(box.left),
    insetInlineEnd: px(box.right),
    width: px(box.width),
    height: px(box.height),
    minWidth: px(box.minWidth),
    maxWidth: px(box.maxWidth),
  }
}

/** The mark over the task being looked at, and its readout over the lane. */
const TIP_WIDTH = 280
const mark = computed(() => {
  const current = shown.value
  return (
    current && { ...markAt(current.lane, current.index, drawing.value.unit), group: current.group }
  )
})
const tipStyle = computed(() => {
  const current = shown.value
  return current ? place(tipAt(current.lane, current.index, drawing.value, TIP_WIDTH)) : {}
})

const hintId = useId()
function countId(lane: LaneDrawing): string {
  return `${hintId}-count-${drawing.value.lanes.indexOf(lane)}`
}
</script>

<template>
  <figure class="branch-map">
    <figcaption class="visually-hidden">{{ caption }}</figcaption>
    <div
      class="branch-map-legend"
      aria-hidden="true"
    >
      <SemanticState
        v-for="entry in legend"
        :key="entry.state"
        dimension="work-item-chain-group"
        :state="entry.state"
        :label="entry.label"
      />
    </div>
    <div
      ref="canvas"
      class="branch-map-canvas"
      :style="{ height: `${drawing.height}px` }"
    >
      <svg
        class="branch-map-svg"
        aria-hidden="true"
        focusable="false"
        :width="drawing.width"
        :height="drawing.height"
        :viewBox="`0 0 ${drawing.width} ${drawing.height}`"
      >
        <template
          v-for="lane in drawing.lanes"
          :key="lane.lane.key"
        >
          <path
            v-if="lane.stem"
            class="branch-map-stem"
            :d="lane.stem"
          />
          <path
            v-for="path in lane.paths"
            :key="path.group"
            class="branch-map-run"
            :d="path.d"
            :data-tone="statePresentation('work-item-chain-group', path.group).tone"
          />
          <path
            v-for="path in lane.raised"
            :key="`raised-${path.group}`"
            class="branch-map-run raised"
            :d="path.d"
            :data-tone="statePresentation('work-item-chain-group', path.group).tone"
          />
          <path
            v-for="path in lane.dots"
            :key="`dot-${path.group}`"
            class="branch-map-dot"
            :d="path.d"
            :data-tone="statePresentation('work-item-chain-group', path.group).tone"
          />
        </template>
        <rect
          v-if="mark"
          class="branch-map-mark"
          rx="2"
          :x="mark.x"
          :y="mark.y"
          :width="mark.width"
          :height="mark.height"
          :data-tone="statePresentation('work-item-chain-group', mark.group).tone"
        />
      </svg>

      <template
        v-for="lane in drawing.lanes"
        :key="lane.lane.key"
      >
        <div
          class="branch-map-head"
          :class="{ before: lane.before, stacked: lane.stacked }"
          :style="place(lane.head)"
        >
          <button
            class="branch-map-label"
            type="button"
            :class="{ selected: isFiltered(lane) }"
            :aria-current="currentOf(lane)"
            :aria-label="t('workItem.chain.map.filterLane', { name: laneName(lane.lane) })"
            :aria-describedby="countId(lane)"
            :title="titleOf(lane)"
            @click="emit('lane', lane.lane.key)"
          >
            {{ laneName(lane.lane) }}
          </button>
          <span
            :id="countId(lane)"
            class="branch-map-count"
            >{{ laneCounts(lane.lane) }}</span
          >
        </div>
        <div
          class="branch-map-lane"
          role="slider"
          tabindex="0"
          aria-orientation="horizontal"
          aria-valuemin="1"
          :aria-valuemax="lane.lane.members.length"
          :aria-valuenow="cursorOf(lane.lane) + 1"
          :aria-valuetext="positionOf(lane)"
          :aria-label="laneLabel(lane.lane)"
          :aria-describedby="hintId"
          :style="place(lane.band)"
          @pointermove="point(lane, $event)"
          @pointerleave="leave"
          @click="openAt(lane, $event)"
          @keydown="move(lane, $event)"
          @focus="enter(lane)"
          @blur="exit(lane)"
        />
        <span
          v-for="label in lane.labels"
          :key="label.reference"
          class="branch-map-reference"
          aria-hidden="true"
          :style="place(label.box)"
          >{{ label.reference }}</span
        >
      </template>

      <ChainBranchTip
        v-if="shown"
        :style="tipStyle"
        :group="shown.group"
        :member="shown.member"
        :position="shown.index + 1"
        :total="shown.lane.lane.members.length"
      />
    </div>
    <p
      :id="hintId"
      class="visually-hidden"
    >
      {{ t('workItem.chain.map.hint') }}
    </p>
    <p
      class="branch-map-announcement visually-hidden"
      aria-live="polite"
    >
      {{ announcement }}
    </p>
  </figure>
</template>

<style scoped>
.branch-map {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  margin: 0;
}

.branch-map-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-4);
  align-items: center;
}

.branch-map-canvas {
  position: relative;
  min-width: 0;
}

.branch-map-svg {
  position: absolute;
  inset: 0;
  display: block;
  overflow: visible;
  pointer-events: none;
}

.branch-map-stem {
  fill: none;
  stroke: var(--color-graph-line-muted);
  stroke-linecap: round;
  stroke-width: 2;
}

/* A lane is a status edge: 3px in the colour of the state it carries, the
   neutral grey of work ahead unless a tone says otherwise. */
.branch-map-run {
  fill: none;
  stroke: var(--color-text-tertiary);
  stroke-width: 3;

  &[data-tone='success'] {
    stroke: var(--color-success);
  }

  &[data-tone='info'] {
    stroke: var(--color-info);
  }

  &[data-tone='warning'] {
    stroke: var(--color-warning);
  }

  &[data-tone='danger'] {
    stroke: var(--color-danger);
  }

  /* Where a unit is a pixel or two, work under way or stuck would vanish at the
     line's weight; it stands out of the lane as a rounded mark instead. */
  &.raised {
    stroke-linecap: round;
    stroke-width: 7;
  }
}

.branch-map-dot,
.branch-map-mark {
  fill: var(--color-text-tertiary);

  &[data-tone='success'] {
    fill: var(--color-success);
  }

  &[data-tone='info'] {
    fill: var(--color-info);
  }

  &[data-tone='warning'] {
    fill: var(--color-warning);
  }

  &[data-tone='danger'] {
    fill: var(--color-danger);
  }
}

/* The task being looked at stands out of its lane by a ring in the text tone,
   which reads against every state colour. */
.branch-map-mark {
  stroke: var(--color-text);
  stroke-width: 1.5;
}

.branch-map-head {
  position: absolute;
  display: flex;
  gap: var(--space-2);
  align-items: center;
  width: max-content;
  height: 24px;

  /* Two lines where one fits nowhere: the label, and its counts under it. */
  &.stacked {
    flex-direction: column;
    gap: 0;
    align-items: flex-start;
    height: auto;
  }

  /* A label line ending at its stem holds both lines against it. */
  &.stacked.before {
    align-items: flex-end;
  }
}

.branch-map-label {
  flex: 0 0 auto;
  min-block-size: 24px;
  padding: 0;
  border: 0;
  color: var(--color-text);
  font: var(--font-group-heading);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  background: none;
  cursor: pointer;

  &:hover,
  &:focus-visible,
  &.selected {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  &.selected {
    color: var(--color-accent);
  }
}

/* The counts stand at the lane's end when the lane is long enough to hold
   them, and follow the label when it is not. */
.branch-map-count {
  min-width: 0;
  max-width: 100%;
  margin-inline-start: auto;
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.branch-map-lane {
  position: absolute;
  border-radius: var(--radius-status);
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }
}

.branch-map-reference {
  position: absolute;
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
  text-align: center;
  white-space: nowrap;
  pointer-events: none;
}
</style>
