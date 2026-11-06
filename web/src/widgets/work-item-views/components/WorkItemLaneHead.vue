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
const away = computed(() => props.left !== '' || props.right !== '')
const stateShown = computed(() => props.lane.epic && printsFacet('state', 'lane', props.lane.epic))
const openLabel = computed(() =>
  t('workItem.lanes.openEpic', { reference: props.lane.epic?.reference ?? '' }),
)
const chainLabel = computed(() =>
  t('workItem.lanes.showChain', { reference: props.lane.epic?.reference ?? '' }),
)

const toggle = ref<HTMLElement | null>(null)
const tail = ref<HTMLElement | null>(null)
const actions = ref<HTMLElement | null>(null)
const { place } = useLaneActionsPlace({ actions, tail, toggle }, () => [
  props.left,
  props.right,
  counts.value,
  stateShown.value,
])
const crowded = computed(() => place.value === 'beside')
const tied = computed(() => place.value === 'tied')

// The spaces live in the strings: a template trims the space before a tag
// closes, which ran «To the right:» into the count for a screen reader.
const TO_LEFT = '← '
const TO_RIGHT = ' →'
const leftLead = computed(() => `${t('workItem.lanes.offLeft')} `)
const rightLead = computed(() => `${t('workItem.lanes.offRight')} `)
</script>

<template>
  <header
    class="lane-head"
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
        <span class="lane-title">{{ title }}</span>
      </span>
    </button>
    <span
      ref="tail"
      class="lane-tail"
    >
      <SemanticState
        v-if="props.lane.epic"
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
          variant="ghost"
          size="inline"
          :title="openLabel"
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
          variant="ghost"
          size="inline"
          :title="chainLabel"
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
  </header>
</template>

<style scoped>
/* Held at the left edge of what is visible, however far the states scroll,
   and under the row of state names while its lane passes, on the workspace's
   own ground so the tiles go under it rather than through it. It leaves with
   the last of its lane, because a sticky box never leaves its own section.
   One row while it fits, the title giving way first. A row it wraps onto starts
   where the heading's words do, under the reference rather than under the
   chevron: the box is inset by the toggle's inset, the chevron and their gap,
   and the toggle alone takes that back. Wrapped from the box's own edge, the
   counts stood 4px left of the chevron and 28px left of the number they count
   for. */
.lane-head {
  /* The chevron's drawn size, as the template asks `VIcon` for it. */
  --lane-chevron-size: 16px;

  /* The two actions side by side. Where an icon answers a press across 44px
     (`reach.css`), they stand far enough apart for the two reaches not to meet, and the
     last keeps its reach inside the board, whose edge clipped it. */
  --lane-actions-width: calc(2 * var(--size-control-inline) + var(--space-1));

  position: sticky;
  top: var(--lanes-head-block);
  left: 0;
  z-index: 1;
  display: flex;
  grid-column: 1 / -1;
  gap: var(--space-1) var(--space-3);
  justify-self: start;
  align-items: center;
  width: var(--board-visible-width);
  min-width: 0;
  min-height: var(--size-control-height-compact);
  padding-inline-start: calc(var(--space-1) + var(--lane-chevron-size) + var(--space-2));
  background: var(--color-canvas);

  @media (pointer: coarse), (width <= 620px) {
    --lane-actions-width: calc(var(--size-control-target) * 1.5 + var(--size-control-inline) / 2);
  }
}

/* A heading that also says where its work out of sight is would squeeze its
   title down to a letter, and so would a narrow board: these wrap, and what
   follows the title goes to the next line rather than cut it. Elsewhere the line
   stays one row, as it always has, and only the title gives way. */
.lane-head.away {
  flex-wrap: wrap;
}

@container board-lanes (width <= 560px) {
  .lane-head {
    flex-wrap: wrap;
  }
}

/* As wide as its words, so the counts follow the title rather than standing at
   the far end. Where the heading wraps, the line breaks before what follows the
   title once title and tail no longer fit it whole: the title keeps its words, as
   a line of its own or the whole line, and the tail goes below. A floor that held
   the tail beside it cut a long title to a third of its words on a wide board.
   On a line that cannot wrap the title gives way a thousand times faster than the
   tail, so the tail stays whole. */
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

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
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

  /* Beside the actions, the reference and the title end short of them: the row is
     the board's visible width, less the toggle's insets, the chevron and its gap. */
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

/* The title is what gives way: the reference and the state beside it are
   shorter and say which lane this is. */
.lane-title {
  min-width: 0;
  font: var(--font-row-title);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The state, the counts, the note of work out of sight and an epic's actions:
   beside the title while they fit there, else on the rows below, where they wrap
   part by part. Wherever the actions stand, a place of their width is the last
   part, so whether the tail fits beside the title does not depend on where they
   stand. The lines stand apart by their parts' own margin rather than by a gap,
   so the empty place, wrapped onto a line of its own, is a line of no height. */
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

  /* The lane of work under no epic has no actions: its parts wrap one by one
     with the title's. */
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

/* At the end of the heading's last line, in a place of their own, so nothing moves
   or is covered when they come up; where that line is full, at the end of the first
   (`useLaneActionsPlace`). Icons, as an entry's actions are, with their words in
   the tooltip and for a screen reader. They stay in the Tab order, and arriving
   there is what shows them; a press with the pointer leaves focus behind without
   leaving them up. */
.lane-actions {
  display: flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
  margin-inline-start: auto;
  opacity: 0;
  transition: opacity var(--duration-quick) var(--ease-out);

  /* Reaches of 44px around icons of 28px: as far apart as each reaches past its icon, and
     the last as far from the heading's end. */
  @media (pointer: coarse), (width <= 620px) {
    gap: calc(var(--size-control-target) - var(--size-control-inline));
    padding-inline-end: calc(var(--size-control-target) / 2 - var(--size-control-inline) / 2);
  }

  .lane-head:is(:hover, :has(:focus-visible)) & {
    opacity: 1;
  }

  /* Nothing can hover here, so they stand. */
  @media (hover: none) {
    opacity: 1;
  }

  .crowded & {
    position: absolute;
    inset-block-start: 0;
    inset-inline-end: 0;
    block-size: var(--size-control-height-compact);
    margin: 0;
  }
}

/* Where the title would not stay whole beside the actions, the part that ends the
   heading's text comes down with them onto a line of their own: a break of no height
   ends the line above. The order puts the break before that part whatever it is, and
   changes nothing while there is no break. */
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
</style>
