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
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { BoardLane } from '@/widgets/work-item-views/utils/boardLanes.ts'

import { printsFacet } from '@/entities/work-item/utils/facets.ts'

import SemanticState from '@/shared/ui/SemanticState.vue'
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
const stateShown = computed(() => props.lane.epic && printsFacet('state', 'lane', props.lane.epic))

// The spaces live in the strings: a template trims the space before a tag
// closes, which ran «To the right:» into the count for a screen reader.
const TO_LEFT = '← '
const TO_RIGHT = ' →'
const leftLead = computed(() => `${t('workItem.lanes.offLeft')} `)
const rightLead = computed(() => `${t('workItem.lanes.offRight')} `)
</script>

<template>
  <header class="lane-head">
    <button
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
      <span
        v-if="props.lane.epic"
        class="lane-reference"
        >{{ props.lane.epic.reference }}</span
      >
      <span class="lane-title">{{ title }}</span>
    </button>
    <SemanticState
      v-if="props.lane.epic"
      class="lane-state"
      dimension="work-item-state"
      :class="{ 'visually-hidden': !stateShown }"
      :state="props.lane.epic.state.category"
      :label="props.lane.epic.state.name"
    />
    <span class="lane-tail">
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
        v-if="props.lane.epic"
        class="lane-actions"
      >
        <VButton
          variant="ghost"
          size="inline"
          :aria-label="t('workItem.lanes.openEpic', { reference: props.lane.epic.reference })"
          @click="emit('open', props.lane.epic.reference)"
          >{{ t('workItem.lanes.open') }}</VButton
        >
        <VButton
          variant="ghost"
          size="inline"
          :aria-label="t('workItem.lanes.showChain', { reference: props.lane.epic.reference })"
          @click="emit('chain', props.lane.epic.reference)"
          >{{ t('workItem.lanes.chain') }}</VButton
        >
      </span>
    </span>
  </header>
</template>

<style scoped>
/* Held at the left edge of what is visible, however far the states scroll,
   and under the row of state names while its lane passes, on the workspace's
   own ground so the tiles go under it rather than through it. It leaves with
   the last of its lane, because a sticky box never leaves its own section.
   One row while it fits, the title giving way first down to a floor; only
   where the title would be squeezed past it do the state, counts and work out
   of sight take a second row. A row it wraps onto starts where the heading's
   words do, under the reference rather than under the chevron: the box is
   inset by the toggle's inset, the chevron and their gap, and the toggle alone
   takes that back. Wrapped from the box's own edge, the counts stood 4px left
   of the chevron and 28px left of the number they count for. */
.lane-head {
  /* The chevron's drawn size, as the template asks `VIcon` for it. */
  --lane-chevron-size: 16px;

  /* What the toggle keeps before the counts wrap: the chevron, the reference and
     some thirty characters of the title. */
  --lane-title-floor: 320px;

  position: sticky;
  top: var(--lanes-head-block);
  left: 0;
  z-index: 1;
  display: flex;
  flex-wrap: wrap;
  grid-column: 1 / -1;
  gap: var(--space-1) var(--space-3);
  justify-self: start;
  align-items: center;
  width: var(--board-visible-width);
  min-width: 0;
  min-height: var(--size-control-height-compact);
  padding-inline-start: calc(var(--space-1) + var(--lane-chevron-size) + var(--space-2));
  background: var(--color-canvas);
}

/* It wraps by its floor and grows to its words, so the counts follow the title
   rather than standing at the far end, and a title that fits is never cut. It
   takes the row's free room a thousand times faster than the tail beside it, so a
   long title gives way first and the tail only takes what is left once the title
   has its words. */
.lane-toggle {
  display: inline-flex;
  flex: 1000 1 var(--lane-title-floor);
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
  color: var(--color-text-tertiary);
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
  color: var(--color-text-tertiary);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

/* Where the lane's work out of sight is, beside the counts it explains. It is
   the one part of the heading that wraps inside itself, so a narrow board
   names every state it lists rather than running the last one off the edge. */
.lane-elsewhere {
  flex: 0 1 auto;
  min-width: 0;
  color: var(--color-text-muted);
  font: var(--font-count);
  font-variant-numeric: tabular-nums;
}

/* The counts, the note of work out of sight and the actions wrap as one unit, so a
   row never holds the actions alone and the counts wrap only when the title's floor,
   the counts and the actions do not fit beside each other. Where the title is short
   the unit takes the rest of the row, and the actions stand at its end. */
.lane-tail {
  display: flex;
  flex: 1 1 auto;
  gap: var(--space-3);
  align-items: center;

  /* Nothing can hover here: the unit goes back to the heading's own flow, where the
     actions stand at the end of its rows as they always have. */
  @media (hover: none) {
    display: contents;
  }
}

/* A place of their own at the end of the row, not laid over it: they take their
   inline size from the start, empty at rest and filled when a pointer is over the
   heading or the keyboard has reached them, so nothing moves or is covered when
   they come up. They stay in the Tab order, and arriving there is what shows them;
   a press with the pointer leaves focus behind without leaving them up. */
.lane-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
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
}
</style>
