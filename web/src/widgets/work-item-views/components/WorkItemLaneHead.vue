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
const away = computed(() => props.left !== '' || props.right !== '')
const stateShown = computed(() => props.lane.epic && printsFacet('state', 'lane', props.lane.epic))

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
    :class="{ away }"
  >
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
  </header>
</template>

<style scoped>
/* Held at the left edge of what is visible, however far the states scroll,
   and under the row of state names while its lane passes, on the workspace's
   own ground so the tiles go under it rather than through it. It leaves with
   the last of its lane, because a sticky box never leaves its own section.
   One row while it fits, the title giving way first; on a narrow board the
   state, counts and actions take a second row instead of squeezing the title
   down to its reference. */
.lane-head {
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
  background: var(--color-canvas);
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

/* Out of sight at rest and in place all the same, so the line does not shift when
   they come up. They stay in the Tab order, and arriving there is what shows them;
   a press with the pointer leaves focus behind without leaving them up. */
.lane-actions {
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
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

/* A heading that also says where its work out of sight is would squeeze its
   title down to a letter, so it takes a second row instead. */
.lane-head.away {
  flex-wrap: wrap;
}

@container board-lanes (width <= 560px) {
  .lane-head {
    flex-wrap: wrap;
  }

  /* A row of their own would be a blank one at rest, so a pointer brings them up
     over the end of the last row; where nothing can hover they keep their row. */
  @media (hover: hover) {
    .lane-actions {
      position: absolute;
      inset-block-end: 0;
      inset-inline-end: 0;
      background: var(--color-canvas);
    }
  }
}
</style>
