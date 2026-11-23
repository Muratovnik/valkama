<script setup lang="ts">
/**
 * What names a lane and folds it, at the start of its heading (`WorkItemLaneHead`): the
 * chevron, the lane card's reference and the lane's title (`laneTitle`). The whole line is
 * one press that folds the lane, save by stage, where each part of the path «Goal › Stage»
 * is a press that opens that part's card and the chevron alone folds the lane: one press
 * for the whole line could do only one of them.
 *
 * The heading measures its room against this element and its `.lane-words` and
 * `.lane-title` (`useLaneActionsPlace`), so both forms keep them.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import type { BoardLane } from '@/widgets/work-item-views/utils/boardLanes.ts'
import { PATH_STEP } from '@/widgets/work-item-views/utils/laneTitle.ts'

import { vWorkItemTitle } from '@/entities/work-item/components/workItemTitle.ts'

import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{
  /** The id of the lane body the toggle shows and hides. */
  bodyId: string
  lane: BoardLane
  open: boolean
  title: string
  /** The heading's actions stand beside the title, so the words end short of them. */
  crowded?: boolean
}>()

const emit = defineEmits<{
  open: [reference: string]
  toggle: []
}>()

const { t } = useI18n()

/** By stage, the cards of the path from the goal down to the lane's own, each a press. */
const parts = computed(() => {
  const { head } = props.lane
  return head.kind === 'container' && head.path.length ? [...head.path, head.item] : []
})
const partLabel = (part: { reference: string; title: string }) =>
  t('workItem.lanes.openPart', { reference: part.reference, title: part.title })
const chevron = computed(() => (props.open ? 'chevron-down' : 'chevron-right'))
const toggleLabel = computed(() =>
  t(props.open ? 'workItem.lanes.fold' : 'workItem.lanes.unfold', { lane: props.title }),
)
</script>

<template>
  <span
    v-if="parts.length"
    class="lane-toggle path"
    :class="{ crowded: props.crowded }"
  >
    <button
      class="lane-fold"
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
    </button>
    <span class="lane-words">
      <span
        v-if="props.lane.goal"
        class="lane-reference"
        >{{ props.lane.goal.reference }}</span
      >
      <span
        v-tooltip.clipped="props.title"
        class="lane-title one-line"
      >
        <template
          v-for="(part, index) in parts"
          :key="part.work_item_id"
        >
          <span
            v-if="index"
            class="lane-step"
            aria-hidden="true"
            >{{ PATH_STEP }}</span
          >
          <button
            v-work-item-title="part.title"
            v-tooltip.clipped="part.title"
            class="lane-part one-line"
            type="button"
            :aria-label="partLabel(part)"
            @click="emit('open', part.reference)"
          />
        </template>
      </span>
    </span>
  </span>
  <button
    v-else
    class="lane-toggle"
    type="button"
    :class="{ crowded: props.crowded }"
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
        v-if="props.lane.goal"
        class="lane-reference"
        >{{ props.lane.goal.reference }}</span
      >
      <span
        v-work-item-title="props.title"
        v-tooltip.clipped="props.title"
        class="lane-title one-line"
      />
    </span>
  </button>
</template>

<style scoped>
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
   (`WorkItemLaneHead`): the toggle's buttons count that room as theirs. */
.lane-toggle,
.lane-fold,
.lane-part {
  scroll-margin-block-start: calc(-1 * (var(--size-control-height-compact) + var(--space-2)));
}

/* By stage the line is no press of its own: its chevron folds and each part opens a card. */
.lane-toggle.path {
  cursor: default;

  &:hover {
    background: transparent;
  }
}

.lane-fold,
.lane-part {
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  background: transparent;
  border-radius: var(--radius-control);
  cursor: pointer;
}

.lane-fold {
  display: inline-flex;
  flex: 0 0 auto;
  justify-content: center;
  align-items: center;
  min-height: var(--size-control-height-compact);

  &:hover {
    background: var(--color-surface-hover);
  }
}

/* The path keeps every part on its line and each a press: short of room, each part ends in an
   ellipsis, none below a few letters, so the goal and the stage both stay to be pressed. A part
   is as tall as its words: at a control's height it stood below the line the title clips to. */
.lane-toggle.path .lane-title {
  display: inline-flex;
}

.lane-part {
  flex: 0 1 auto;
  min-width: 3em;
  min-block-size: 0;

  &:hover {
    text-decoration: underline;
  }
}

.lane-step {
  flex: 0 0 auto;
  white-space: pre;
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
</style>
