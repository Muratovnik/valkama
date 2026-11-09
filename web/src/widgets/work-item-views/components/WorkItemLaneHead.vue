<script setup lang="ts">
/**
 * A lane's heading: which epic the row is and how much it holds, on one calm
 * line. Its state is said only once the epic has moved; an epic not started
 * keeps the word for a screen reader. The epic's card and chain are one click
 * away and come up under the pointer or the keyboard, so a board of a hundred
 * epics does not stand two buttons per row; where nothing can hover they stay.
 *
 * It is held at the left edge of what the board shows, and at the top while its
 * lane passes under the row of state names, so a lane in view always says whose
 * it is. The note of work out of sight says on which side: «2 в «Review» →».
 */
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { useLaneActionsPlace } from '@/widgets/work-item-views/composables/useLaneActionsPlace.ts'
import type { BoardLane } from '@/widgets/work-item-views/utils/boardLanes.ts'

import { printsFacet } from '@/entities/work-item/utils/facets.ts'

import SemanticState from '@/shared/ui/SemanticState.vue'
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The id of the lane body the toggle shows and hides. */
  bodyId: string
  lane: BoardLane
  /** What the lane holds out of sight to the left; empty when nothing. */
  left: string
  open: boolean
  /** What the lane holds out of sight to the right; empty when nothing. */
  right: string
  /** The width the board shows, which the heading is drawn across; unset until it is measured. */
  boardWidth?: string
}>()

const emit = defineEmits<{
  chain: [reference: string]
  open: [reference: string]
  toggle: []
}>()

const { t } = useI18n()

const title = computed(() => props.lane.epic?.title ?? t('workItem.lanes.noEpic'))
const counts = computed(() =>
  t('workItem.lanes.counts', { open: props.lane.open, closed: props.lane.closed }),
)
const chevron = computed(() => (props.open ? 'chevron-down' : 'chevron-right'))
const toggleLabel = computed(() =>
  t(props.open ? 'workItem.lanes.fold' : 'workItem.lanes.unfold', { lane: title.value }),
)
const away = computed(() => props.left !== '' || props.right !== '')
const stateShown = computed(() => props.lane.epic && printsFacet('state', 'lane', props.lane.epic))
const openLabel = computed(() =>
  t('workItem.lanes.openEpic', { reference: props.lane.epic?.reference ?? '' }),
)
const chainLabel = computed(() =>
  t('workItem.lanes.showChain', { reference: props.lane.epic?.reference ?? '' }),
)

const head = ref<HTMLElement | null>(null)
const toggle = ref<HTMLElement | null>(null)
const tail = ref<HTMLElement | null>(null)
const actions = ref<HTMLElement | null>(null)
const parts = { actions, head, tail, toggle }
const named = () => props.lane.epic?.state.name
const words = () => [props.left, props.right, counts.value, stateShown.value, title.value, named()]
const { layout } = useLaneActionsPlace(parts, () => props.boardWidth, words)
const crowded = computed(() => layout.value.place === 'beside')
const tied = computed(() => layout.value.place === 'tied')
// The state on the title's line, apart from the counts: one of the two places below says it.
const raised = computed(() => layout.value.raised)

// The spaces live in the strings: a template trims the space before a tag
// closes, which ran «To the right:» into the count for a screen reader.
const TO_LEFT = '← '
const TO_RIGHT = ' →'
const leftLead = computed(() => `${t('workItem.lanes.offLeft')} `)
const rightLead = computed(() => `${t('workItem.lanes.offRight')} `)
</script>

<template>
  <header
    ref="head"
    class="lane-head reach-room"
    :class="{ acting: props.lane.epic, away, crowded, tied }"
  >
    <button
      ref="toggle"
      class="lane-toggle"
      type="button"
      :aria-expanded="props.open"
      :aria-controls="props.bodyId"
      :aria-label="toggleLabel"
      @click="emit('toggle')"
    >
      <VIcon
        class="lane-chevron"
        :name="chevron"
        :size="16"
      />
      <span class="lane-words">
        <span
          v-if="props.lane.epic"
          class="lane-reference"
          >{{ props.lane.epic.reference }}</span
        >
        <span
          v-tooltip.clipped="title"
          class="lane-title one-line"
          >{{ title }}</span
        >
      </span>
    </button>
    <SemanticState
      v-if="props.lane.epic && raised"
      class="lane-state"
      dimension="work-item-state"
      :state="props.lane.epic.state.category"
      :label="props.lane.epic.state.name"
    />
    <span
      ref="tail"
      class="lane-tail"
    >
      <SemanticState
        v-if="props.lane.epic && !raised"
        class="lane-state"
        dimension="work-item-state"
        :class="{ 'visually-hidden': !stateShown }"
        :state="props.lane.epic.state.category"
        :label="props.lane.epic.state.name"
      />
      <span class="lane-counts">{{ counts }}</span>
      <span
        v-if="props.left"
        class="lane-elsewhere"
        ><span aria-hidden="true">{{ TO_LEFT }}</span
        ><span class="visually-hidden">{{ leftLead }}</span
        >{{ props.left }}</span
      >
      <span
        v-if="props.right"
        class="lane-elsewhere"
        ><span class="visually-hidden">{{ rightLead }}</span
        >{{ props.right }}<span aria-hidden="true">{{ TO_RIGHT }}</span></span
      >
      <span
        v-if="tied"
        class="lane-break"
      />
      <span
        v-if="props.lane.epic"
        ref="actions"
        class="lane-actions"
      >
        <VButton
          v-tooltip.name="openLabel"
          class="lane-action"
          variant="ghost"
          size="inline"
          :aria-label="openLabel"
          icon
          reach
          @click="emit('open', props.lane.epic.reference)"
        >
          <VIcon
            name="card"
            :size="16"
          />
        </VButton>
        <VButton
          v-tooltip.name="chainLabel"
          class="lane-action"
          variant="ghost"
          size="inline"
          :aria-label="chainLabel"
          icon
          reach
          @click="emit('chain', props.lane.epic.reference)"
        >
          <VIcon
            name="chain"
            :size="16"
          />
        </VButton>
      </span>
      <span
        v-if="props.lane.epic"
        class="lane-room"
      />
    </span>
    <span class="lane-measure" />
  </header>
</template>

<style scoped>
/* Held at the left edge of what is visible, however far the states scroll, and under the row
   of state names while its lane passes, on the workspace's own ground so the tiles go under it
   rather than through it, and leaving with the last of its lane. One row while it fits, the
   title giving way first. A row it wraps onto starts under the reference, not under the chevron:
   the box is inset by the toggle's inset, the chevron and their gap, and the toggle alone takes
   that back; from the box's own edge, the counts stood 4px left of the chevron. A button's ring
   reaches 4px past it (`base.css`): the heading keeps that room above the toggle, taken back as
   margin, clear of the row of state names, and its ground covers the room the board keeps at its
   edges (`WorkItemBoard`), where tiles showed. */
.lane-head {
  /* The chevron's drawn size, as the template asks `VIcon` for it. */
  --lane-chevron-size: 16px;

  /* The two actions side by side. Where an icon answers a press across 44px (`reach.css`), so
     far apart that the reaches do not meet, and the last within the board, whose edge cut it.
     Each reach stands half of what the target adds past its icon. */
  --lane-reach-past: calc(var(--reach-target) - var(--size-control-inline));
  --lane-actions-width: calc(
    2 * var(--size-control-inline) + max(var(--space-1), var(--lane-reach-past)) +
      var(--lane-reach-past) / 2
  );

  position: sticky;
  top: var(--lanes-head-block);
  left: 0;
  z-index: 1;
  display: flex;
  grid-column: 1 / -1;
  gap: var(--space-1) var(--space-3);
  align-items: center;
  width: var(--board-visible-width);
  min-width: 0;
  min-height: calc(var(--size-control-height-compact) + var(--space-1));
  padding-block-start: var(--space-1);
  padding-inline-start: calc(var(--space-1) + var(--lane-chevron-size) + var(--space-2));
  margin-block-start: calc(-1 * var(--space-1));

  /* The board's width lands in the frame it changes: the reduced-motion rule would ease it. */
  transition-property: none;

  /* Its ground, under its words, over the room at its sides and above it and not below: a shadow
     spread round it hid the first 4px of the tile coming out from under it held at the top, and
     drew nothing in a forced palette, where the tiles passing beside it showed as stripes. */
  &::before {
    content: '';
    position: absolute;
    inset: calc(-1 * var(--space-1)) calc(-1 * var(--space-1)) 0;
    z-index: -1;
    background: var(--color-canvas);
  }
}

/* A heading that also says where its work out of sight is would squeeze its title down to a
   letter, and so would a narrow board: these wrap, and what follows the title goes to the next
   line rather than cut it. Elsewhere the line stays one row, and only the title gives way. */
.lane-head.away {
  flex-wrap: wrap;
}

@container board-lanes (width <= 560px) {
  .lane-head {
    flex-wrap: wrap;
  }
}

/* As wide as its words, so the counts follow the title rather than standing at the far end.
   Where the heading wraps, the line breaks before what follows the title once title and tail no
   longer fit it whole: the title keeps its words, as a line of its own or the whole line, and the
   tail goes below. A floor that held the tail beside it cut a long title to a third of its words
   on a wide board. On a line that cannot wrap the title gives way a thousand times faster. */
.lane-toggle {
  display: inline-flex;
  flex: 0 1000 auto;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  max-width: max-content;
  min-height: var(--size-control-height-compact);
  padding: 0 var(--space-2) 0 var(--space-1);
  margin-inline-start: calc(-1 * var(--space-1) - var(--lane-chevron-size) - var(--space-2));
  border: 0;
  color: var(--color-text);
  text-align: start;
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }
}

/* The board keeps a tile it brings into view clear of a heading held at its top
   (`scroll-padding-block` in `WorkItemLanes`). The heading's own buttons stand in that room, and
   the keyboard reaching one scrolled the board back to clear it: they count that room as theirs. */
.lane-toggle,
.lane-action {
  scroll-margin-block-start: calc(-1 * (var(--size-control-height-compact) + var(--space-2)));
}

.lane-chevron {
  flex: 0 0 auto;
  color: var(--color-text-muted);
}

.lane-words {
  display: inline-flex;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;

  /* Beside the actions, the words end short of them: the row less the toggle's insets, the
     chevron, its gap and the actions. */
  .crowded & {
    max-width: calc(
      var(--board-visible-width) - var(--space-1) - var(--lane-chevron-size) - 3 * var(--space-2) -
        var(--lane-actions-width)
    );
  }
}

.lane-reference {
  flex: 0 0 auto;
  color: var(--color-text-tertiary);
  font: var(--font-detail);
  font-variant-numeric: tabular-nums;
}

/* The title gives way: the reference and the state beside it are shorter and say whose it is. */
.lane-title {
  font: var(--font-row-title);
}

/* The state, the counts, the note of work out of sight and an epic's actions: beside the title
   while they fit there, else on the rows below, where they wrap part by part. The state leaves
   them for the title's line where it fits there and the heading takes a line fewer
   (`useLaneActionsPlace`): under a short title it and the counts left the actions a line of
   their own, which the state beside the title gives back. Wherever the actions stand, a place of
   their width is the last part, so whether the tail fits beside the title does not depend on
   where they stand. The lines stand apart by their parts' own margin rather than by a gap, so
   the empty place, wrapped onto a line of its own, is a line of no height. */
.lane-tail {
  display: flex;
  flex: 1 0 auto;
  flex-wrap: wrap;
  column-gap: var(--space-3);
  align-items: center;
  min-width: 0;
  margin-block-start: calc(-1 * var(--space-1));

  > :not(.lane-room, .lane-break) {
    margin-block-start: var(--space-1);
  }

  .lane-head:is(.away, :not(.acting)) & {
    flex-shrink: 1;
  }

  /* The lane of work under no epic has no actions: its parts wrap one by one with the title's. */
  .lane-head:not(.acting) & {
    display: contents;

    > * {
      margin-block-start: 0;
    }
  }
}

@container board-lanes (width <= 560px) {
  .lane-tail {
    flex-shrink: 1;
  }
}

.lane-state {
  flex: 0 0 auto;
}

.lane-counts {
  flex: 0 0 auto;
  color: var(--color-text-tertiary);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

/* Where the lane's work out of sight is, beside the counts it explains. It is the one part of
   the heading that wraps inside itself, so a narrow board names every state it lists. */
.lane-elsewhere {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

/* At the end of the heading's last line, in a place of their own, so nothing moves or is
   covered when they come up; where that line is full, at the end of the first. Icons, as an
   entry's actions are, with their words in the tooltip and for a screen reader. Arriving there
   by Tab shows them; a press with the pointer leaves focus behind without leaving them up. */
.lane-actions {
  display: flex;
  flex: 0 0 auto;

  /* Where a finger presses, reaches of 44px around icons of 28px: as far apart as each reaches
     past its icon, and the last as far from the heading's end. */
  gap: max(var(--space-1), var(--lane-reach-past));
  align-items: center;
  padding-inline-end: calc(var(--lane-reach-past) / 2);
  margin-inline-start: auto;
  opacity: 0;
  transition: opacity var(--duration-quick) var(--ease-out);

  .lane-head:is(:hover, :has(:focus-visible)) & {
    opacity: 1;
  }

  /* Nothing can hover here, so they stand. */
  @media (hover: none) {
    opacity: 1;
  }

  .crowded & {
    position: absolute;
    inset-block-start: var(--space-1);
    inset-inline-end: 0;
    block-size: var(--size-control-height-compact);
    margin: 0;
  }
}

/* Where the title would not stay whole beside the actions, the part that ends the heading's
   text comes down with them onto a line of their own: a break of no height ends the line above.
   The order puts the break before that part whatever it is, and nothing while there is none. */
.lane-break {
  flex-basis: 100%;
  order: 1;
  height: 0;
}

.lane-tail > :has(+ .lane-break),
.lane-actions,
.lane-room {
  order: 2;
}

/* The actions' place in the lines while they stand beside the title. */
.lane-room {
  display: none;
  flex: 0 0 var(--lane-actions-width);

  .crowded & {
    display: block;
  }
}

.lane-measure {
  position: absolute;
  inset: 0 0 auto;
  height: 0;
}
</style>

<style scoped src="@/shared/ui/reach.css"></style>
