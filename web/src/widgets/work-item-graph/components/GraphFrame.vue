<script setup lang="ts">
/**
 * An epic on the graph, as the frame round its work: or folded, its header
 * alone.
 *
 * The frame is ground a step above the field and its cards a step above it, so
 * it is told by tone and draws no line. Its header is one row of two controls,
 * each one button with one action as a card is: the chevron folds or unfolds
 * it, the rest opens the epic's card. The rest reads as a card on the field
 * does: the reference line with the state once it has moved, two lines of title,
 * then how the work stands in words; the 3px edge under it is the same count
 * drawn.
 *
 * The header is one height and one arrangement whether the frame is folded or
 * open (`FRAME_HEADER`), so folding moves nothing in it. Each line keeps its
 * place whatever the others hold; only counts that take a third line take it
 * from the title's second. An epic nothing was filed under says so and draws no
 * edge; a frame with nothing to unfold has no chevron, and its column stays.
 *
 * A folded frame says what it hides, in words and as the sheets of a stack under
 * it, counted by the epic and never by a filter, at every zoom: «90 open inside»,
 * «90 inside» in the overview, and «+90» where a word could no longer be read.
 *
 * Far out a header is a few pixels and the frame round it is what the hand finds, so
 * the ground of an open frame with an epic opens that epic too. It is a shortcut for
 * the pointer alone: the header's button is the same action for the keyboard, so no
 * new stop stands here, and a drag from the ground moves the field and opens nothing.
 *
 * The work under no epic is a frame too, with no epic to open. A frame inside
 * a frame is a well cut into it, a step below. Zoomed out past reading, the
 * header keeps the epic's reference and its edge, grown with the field.
 *
 * Every control carries `data-walk-target`, the id the keyboard's walk knows it
 * by: `frame:<id>:fold` and `frame:<id>`.
 */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { Handle, Position } from '@vue-flow/core'

import GraphFrameCounts from '@/widgets/work-item-graph/components/GraphFrameCounts.vue'
import GraphFrameLine from '@/widgets/work-item-graph/components/GraphFrameLine.vue'
import GraphFrameProgress from '@/widgets/work-item-graph/components/GraphFrameProgress.vue'
import { useGraphFrameWords } from '@/widgets/work-item-graph/composables/useGraphFrameWords.ts'
import { FRAME_HEADER } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { PlacedFrame } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { foldIsTarget } from '@/widgets/work-item-graph/utils/graphWalk.ts'

import VIcon from '@/shared/ui/VIcon.vue'

const {
  frame,
  far = false,
  overview = false,
  still = false,
  tabStop = null,
  working = 0,
} = defineProps<{
  frame: PlacedFrame
  /** Further still: the overview's words could not be read, so a header says less, larger. */
  far?: boolean
  /** The field is zoomed out past reading: the header is the reference and the edge. */
  overview?: boolean
  /** The field's motion does not run, so the working dots hold still. */
  still?: boolean
  /** The walk target that takes Tab, when it is one of this frame's. */
  tabStop?: string | null
  /**
   * How many items under it, nested frames' included, an agent is working on
   * now: for a folded frame the one sign of the work moving inside it.
   */
  working?: number
}>()
const emit = defineEmits<{
  blur: [target: string]
  focus: [target: string]
  open: [reference: string]
  toggle: [id: string]
}>()
const { t } = useI18n()

const { epic, foldLabel, inside, insideShown, openLabel } = useGraphFrameWords({
  far: () => far,
  frame: () => frame,
  overview: () => overview,
  working: () => working,
})

const foldTarget = computed(() => `frame:${frame.id}:fold`)
/** The keyboard's rule: hidden in the overview where the epic's button stands beside it. */
const foldShown = computed(() => foldIsTarget(frame, overview))
const openTarget = computed(() => `frame:${frame.id}`)

const chevron = computed(() => (frame.folded ? 'chevron-right' : 'chevron-down'))
const title = computed(() => epic.value?.title ?? t('graph.frame.noEpic'))
/** Far out the count takes the band, and the reference stays in the button's name. */
const referenceShown = computed(() => !(far && inside.value))

/**
 * The open target is a button only where there is an epic to open; over the
 * work under no epic the same row is plain text.
 */
const openTag = computed(() => (epic.value ? 'button' : 'span'))
/** What only the button carries: plain text has no type, name, walk target or stop. */
const asButton = <T,>(value: T): T | undefined => (epic.value ? value : undefined)
const openType = computed(() => asButton('button'))
const openName = computed(() => asButton(openLabel.value))
const openWalk = computed(() => asButton(openTarget.value))
const openTab = computed(() => asButton(tabIndex(openTarget.value)))
/**
 * Zoomed out, the band's second row is free where a fold hides nothing and the words are not
 * grown past it, and what the reference leaves no room for on the first row takes it.
 */
const bandWraps = computed(() => overview && !far && !inside.value)
/** Zoomed out a header shows less than it is, so the pointer is told the rest, as a card is. */
const openHint = computed(() => (overview ? openName.value : undefined))

/** A frame inside a frame is a well cut into the one it stands in. */
const nested = computed(() => frame.parentId !== null)
const headStyle = { height: `${FRAME_HEADER}px` }
/** Far out, the ground of an open frame opens its epic. A folded frame is all header. */
const groundOpens = computed(() => far && !frame.folded && Boolean(epic.value))

function tabIndex(target: string): number {
  return tabStop === target ? 0 : -1
}

function onOpen() {
  if (epic.value) emit('open', epic.value.reference)
}

function onGround() {
  if (groundOpens.value) onOpen()
}

function onOpenFocus() {
  if (epic.value) emit('focus', openTarget.value)
}

function onOpenBlur() {
  if (epic.value) emit('blur', openTarget.value)
}
</script>

<template>
  <!-- The header's button is this same action for the keyboard. -->
  <!-- eslint-disable-next-line vuejs-accessibility/click-events-have-key-events, vuejs-accessibility/no-static-element-interactions -->
  <section
    class="graph-frame"
    :class="{
      far,
      'folded': frame.folded,
      'ground-opens': groundOpens,
      'holding': frame.folded && frame.foldable,
      nested,
      overview,
    }"
    :data-frame="frame.id"
    @click.self="onGround"
  >
    <Handle
      id="target"
      class="graph-frame-handle"
      type="target"
      :position="Position.Left"
      :connectable="false"
    />
    <Handle
      id="source"
      class="graph-frame-handle"
      type="source"
      :position="Position.Right"
      :connectable="false"
    />
    <header
      class="graph-frame-head nopan"
      :style="headStyle"
    >
      <button
        v-if="foldShown"
        class="graph-frame-fold"
        type="button"
        :aria-label="foldLabel"
        :aria-expanded="!frame.folded"
        :data-walk-target="foldTarget"
        :tabindex="tabIndex(foldTarget)"
        @click="emit('toggle', frame.id)"
        @focus="emit('focus', foldTarget)"
        @blur="emit('blur', foldTarget)"
      >
        <VIcon
          :name="chevron"
          :size="16"
        />
      </button>
      <component
        :is="openTag"
        class="graph-frame-open"
        :type="openType"
        :aria-label="openName"
        :title="openHint"
        :data-walk-target="openWalk"
        :tabindex="openTab"
        @click="onOpen"
        @focus="onOpenFocus"
        @blur="onOpenBlur"
      >
        <GraphFrameLine
          :class="{ 'graph-frame-band-wraps': bandWraps }"
          :epic="epic"
          :named="referenceShown"
          :overview="overview"
          :still="still"
          :title="title"
          :working="working"
        />
        <span
          v-if="!overview"
          class="graph-frame-name"
        >
          <span
            v-if="epic"
            class="graph-frame-title"
            :title="title"
            >{{ title }}</span
          >
        </span>
        <span
          v-if="inside"
          class="graph-frame-inside"
          >{{ insideShown }}</span
        >
        <GraphFrameCounts
          v-if="!overview"
          :progress="frame.progress"
        />
      </component>
      <GraphFrameProgress
        v-if="frame.progress.total > 0"
        class="graph-frame-progress"
        :progress="frame.progress"
      />
    </header>
  </section>
</template>

<style scoped>
.graph-frame-handle {
  opacity: 0;
  pointer-events: none;
}

/* One step above the field, as the board's lane is; a frame inside a frame is
   a well, one step below the frame it is cut into. The cards stand a step
   above either. A press on the frame pans the field, as one behind it would. */
.graph-frame {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--color-surface);
  border-radius: var(--radius-card);

  &.nested {
    background: var(--color-surface-recess);
  }

  &.ground-opens {
    cursor: pointer;

    &:hover {
      background: var(--color-surface-hover);
    }
  }

  /* Folded over work: the sheets of a stack under it, a shape and no hue, inside
     the air the layout leaves below every frame. */
  &.holding {
    box-shadow:
      0 6px 0 -2px var(--color-surface-hover),
      0 12px 0 -4px var(--color-surface-recess);
  }

  &.holding.overview {
    box-shadow:
      0 16px 0 -4px var(--color-surface-hover),
      0 32px 0 -8px var(--color-surface-recess);
  }
}

/* One arrangement folded or open: the fold's column, the lines beside it, and
   the edge across the foot. The fold's column stays where a frame has no fold,
   so frames standing together keep their text in one line. */
.graph-frame-head {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: var(--space-1);
  padding: var(--space-2);
  color: var(--color-text-muted);
  font: var(--font-line);
  pointer-events: auto;
}

.graph-frame-fold,
.graph-frame-open {
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border-radius: var(--radius-status);
}

.graph-frame-fold,
.graph-frame-open[data-walk-target] {
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    background: var(--color-surface-hover);
    outline: 2px solid var(--color-focus-ring);
    outline-offset: -2px;
  }
}

/* The whole column is the target, and its chevron stands on the reference line. */
.graph-frame-fold {
  display: grid;
  grid-column: 1;
  place-items: start center;
  align-self: stretch;
}

.graph-frame-open {
  display: flex;
  flex-direction: column;
  grid-column: 2;
  gap: var(--space-half);
  align-self: stretch;
  min-height: 0;
  padding-inline-start: var(--space-1);
}

/* The title has the room between the reference line and the foot, three lines
   of it, so what stands at the foot keeps its place whatever the title holds. Only
   counts that take more lines take the title's last, and then the line before it
   ends in the ellipsis. */
.graph-frame-name {
  flex: 1 1 3lh;
  min-height: 0;
  font: var(--font-row-title);
  container-type: size;
}

.graph-frame-title {
  display: -webkit-box;
  min-width: 0;
  color: var(--color-text);
  font: var(--font-row-title);
  overflow-wrap: anywhere;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

@container (height < 50px) {
  .graph-frame-title {
    -webkit-line-clamp: 2;
  }
}

@container (height < 30px) {
  .graph-frame-title {
    -webkit-line-clamp: 1;
  }
}

.graph-frame-inside {
  flex: 0 0 auto;
  color: var(--color-text);
  font: var(--font-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.graph-frame-progress {
  grid-column: 1 / -1;
}

/* A header with no fold beside it takes the fold's column as well, its text where
   it stands in any other header. */
.graph-frame-open:first-child {
  grid-column: 1 / -1;
  padding-inline-start: calc(28px + var(--space-2));
}

/* Zoomed out, the header is a band that still reads and is easy to hit: its words
   grown with the field, as a zoomed-out card's are, over a thicker edge. The whole
   band is the one button, and its target runs on into the air above and below
   it, which the layout leaves empty: 36px, the least air between two frames, so
   the target stops short of the next header. The work under no epic has no
   reference, and keeps its name instead, and its fold, the one button its header
   has (`foldIsTarget`). */
.graph-frame.overview {
  --grow: 2.2;

  &.far {
    --grow: 3.2;
  }

  .graph-frame-open {
    gap: 0;
  }

  .graph-frame-open[data-walk-target],
  .graph-frame-fold {
    position: relative;
    grid-row: 1 / -1;
    grid-column: 1 / -1;

    &::before {
      content: '';
      position: absolute;
      inset: calc(-36px - var(--space-2)) calc(-1 * var(--space-2));
    }
  }

  .graph-frame-open:not([data-walk-target]) {
    grid-row: 1;
    grid-column: 2;
    pointer-events: none;
  }

  .graph-frame-fold {
    place-items: start;
  }

  .graph-frame-inside {
    display: block;
    flex: 0 0 auto;
    max-width: calc(100% / var(--grow));
    height: calc(1lh * var(--grow));
    color: var(--color-text);
    font: var(--font-drawer-title);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transform: scale(var(--grow));
    transform-origin: left top;
  }

  &.far .graph-frame-inside {
    --grow: 5;
  }

  .graph-frame-progress {
    grid-row: 2;
    height: 12px;
    pointer-events: none;
  }

  .graph-frame-band-wraps {
    flex-wrap: wrap;
  }
}

/* A forced palette clears the ground, so the frame is outlined instead. */
@media (forced-colors: active) {
  .graph-frame {
    outline: 1px solid CanvasText;
  }
}
</style>
