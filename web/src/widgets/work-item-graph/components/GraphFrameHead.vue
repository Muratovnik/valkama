<script setup lang="ts">
/**
 * A frame's header: two controls, each one button with one action as a card is. The
 * chevron folds or unfolds the frame, the rest opens the epic's card. The rest reads as a
 * card on the field does: the reference line with the state once it has moved, the title,
 * then how the work stands in words, and the 3px edge under it is the same count drawn.
 *
 * Everything in it starts at one left edge, the one the frame's cards start at: the
 * chevron leads the reference line, and the title and the counts stand under it. The
 * header is as tall as its lines, one to three of title and the counts right under them,
 * and a folded frame says what it hides on a line under its edge, whose room an open one
 * keeps, so folding moves nothing. The layout leaves the room the header takes, measured
 * from this same header (`GraphFrameHeads`), and that is the height it is drawn at.
 *
 * Zoomed out past reading, the header is a band: the epic's reference grown with the
 * field, and what a fold hides beside it. An epic nothing was filed under says so and
 * draws no edge; a frame with nothing to unfold has no chevron.
 *
 * Every control carries `data-walk-target`, the id the keyboard's walk knows it by:
 * `frame:<id>:fold` and `frame:<id>`; a header drawn only to be measured carries none.
 */
import { computed, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'

import GraphFrameCounts from '@/widgets/work-item-graph/components/GraphFrameCounts.vue'
import GraphFrameFold from '@/widgets/work-item-graph/components/GraphFrameFold.vue'
import GraphFrameLine from '@/widgets/work-item-graph/components/GraphFrameLine.vue'
import GraphFrameProgress from '@/widgets/work-item-graph/components/GraphFrameProgress.vue'
import { useGraphBandFit } from '@/widgets/work-item-graph/composables/useGraphBandFit.ts'
import { useGraphFrameWords } from '@/widgets/work-item-graph/composables/useGraphFrameWords.ts'
import { FOLDED_WIDTH, FRAME_PADDING } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import type { FrameHead } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { foldIsTarget } from '@/widgets/work-item-graph/utils/graphWalk.ts'

import { vSlashBreaks } from '@/shared/ui/slashBreaks.ts'

const {
  frame,
  far = false,
  height = null,
  measure = false,
  overview = false,
  still = false,
  tabStop = null,
  working = 0,
} = defineProps<{
  frame: FrameHead
  /** Further still: the overview's words could not be read, so a header says less, larger. */
  far?: boolean
  /** The height the layout gave it; none while it is measured. */
  height?: number | null
  /** Drawn only to be measured: it names no walk target and is no stop. */
  measure?: boolean
  /** The field is zoomed out past reading: the header is the reference and the edge. */
  overview?: boolean
  /** The field's motion does not run, so the working dots hold still. */
  still?: boolean
  /** The walk target that takes Tab, when it is one of this frame's. */
  tabStop?: string | null
  /** How many items under it an agent is working on now. */
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

const title = computed(() => epic.value?.title ?? t('graph.frame.noEpic'))
/** Far out the count takes the band, and the reference stays in the button's name. */
const referenceShown = computed(() => !(far && inside.value))
/** Zoomed out the line holds the reference and the work moving; with neither it takes no row. */
const lineShown = computed(() => !overview || referenceShown.value || working > 0)

/**
 * The open target is a button only where there is an epic to open; over the
 * work under no epic the same row is plain text.
 */
const openTag = computed(() => (epic.value ? 'button' : 'span'))
/** What only the button carries: plain text has no type, name, walk target or stop. */
const asButton = <T,>(value: T): T | undefined => (epic.value ? value : undefined)
/** What only a header on the field carries: one drawn to be measured is reached by nothing. */
const walked = <T,>(value: T): T | undefined => (measure ? undefined : value)
const openType = computed(() => asButton('button'))
const openName = computed(() => asButton(openLabel.value))
const openWalk = computed(() => walked(asButton(openTarget.value)))
const openTab = computed(() => asButton(tabIndex(openTarget.value)))
/**
 * Zoomed out a header shows less than it is, so the pointer is told the rest, as a card is:
 * on the epic's button, or over the work under no epic on the fold, its one button.
 */
const openHint = computed(() => (overview ? openName.value : undefined))
const foldHint = computed(() => (overview && !epic.value ? foldLabel.value : undefined))

const head = useTemplateRef<HTMLElement>('head')
const { fit, secondRow } = useGraphBandFit({
  head,
  overview: () => overview,
  sources: () => [overview, far, height, insideShown.value],
})
/**
 * Zoomed out, the band's second row is free where a fold hides nothing, the words are not
 * grown past it and the header is tall enough to hold it, and what the reference leaves no
 * room for on the first row takes it.
 */
const bandWraps = computed(() => overview && !far && !inside.value && secondRow.value)
/** The height the layout gave it, or its own while it is measured, and how far its band grows. */
const headStyle = computed(() => ({
  'height': height === null ? undefined : `${height}px`,
  '--band-fit': fit.value,
}))
/**
 * The title and the counts run as wide on an open frame as a folded one lets them, so
 * they take as many lines either way and the header the same room.
 */
const lineWidth = { maxWidth: `${FOLDED_WIDTH - 2 * FRAME_PADDING}px` }

function tabIndex(target: string): number {
  return tabStop === target ? 0 : -1
}

function onOpen() {
  if (epic.value) emit('open', epic.value.reference)
}

function onOpenFocus() {
  if (epic.value) emit('focus', openTarget.value)
}

function onOpenBlur() {
  if (epic.value) emit('blur', openTarget.value)
}
</script>

<template>
  <header
    ref="head"
    class="graph-frame-head nopan"
    :class="{ far, overview, 'inside-leads': overview && !lineShown }"
    :style="headStyle"
  >
    <GraphFrameFold
      v-if="foldShown"
      :folded="frame.folded"
      :overview="overview"
      :aria-label="foldLabel"
      :aria-expanded="!frame.folded"
      :title="foldHint"
      :data-walk-target="walked(foldTarget)"
      :tabindex="tabIndex(foldTarget)"
      @click="emit('toggle', frame.id)"
      @focus="emit('focus', foldTarget)"
      @blur="emit('blur', foldTarget)"
    />
    <component
      :is="openTag"
      class="graph-frame-open"
      :class="{ folds: foldShown }"
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
        v-if="lineShown"
        :epic="epic"
        :named="referenceShown"
        :overview="overview"
        :still="still"
        :title="title"
        :working="working"
        :wraps="bandWraps"
      />
      <span
        v-if="!overview && epic"
        v-slash-breaks="title"
        class="graph-frame-title"
        :style="lineWidth"
        :title="title"
      />
      <span
        v-if="overview && inside"
        class="graph-frame-inside"
        >{{ insideShown }}</span
      >
      <GraphFrameCounts
        v-if="!overview"
        :style="lineWidth"
        :progress="frame.progress"
      />
    </component>
    <GraphFrameProgress
      v-if="frame.progress.total > 0"
      class="graph-frame-progress"
      :progress="frame.progress"
    />
    <span
      v-if="!overview && inside"
      class="graph-frame-inside"
      >{{ insideShown }}</span
    >
  </header>
</template>

<style scoped>
/* One column with the frame's cards: the chevron, the reference line beside it, the
   title and the counts under them, the edge across, and what a fold hides under that. */
.graph-frame-head {
  /* The chevron's corner the epic's button leaves to the fold: as wide as the chevron and
     the air after it, as tall as the reference line (`--font-detail`) and the air under it. */
  --notch-inline: calc(16px + var(--space-1));
  --notch-block: calc(var(--font-size-dense) * var(--line-height-snug) + var(--space-half));

  /* A ring's air from what it encloses, and its own width. */
  --ring-air: var(--space-half);
  --ring: 2px;

  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-1);
  align-content: start;
  padding: var(--space-2) var(--space-4);
  color: var(--color-text-muted);
  font: var(--font-line);
  pointer-events: auto;
}

/* As tall as what it holds, and not the row a form's control stands in. */
.graph-frame-open {
  display: flex;
  flex-direction: column;
  grid-area: 1 / 1;
  gap: var(--space-half);
  min-width: 0;
  min-block-size: 0;
  padding: 0;
  border: 0;
  color: inherit;
  font: inherit;
  text-align: left;
  background: transparent;
  border-radius: var(--radius-status);
}

/* Its ring stands clear of its words, in the header's padding: on its edge it lay on the
   first letters and on the counts' last line. */
.graph-frame-open[data-walk-target] {
  cursor: pointer;

  &:hover {
    background: var(--color-surface-hover);
  }

  &:focus-visible {
    background: var(--color-surface-hover);
    outline: solid var(--color-focus-ring);
    outline-width: var(--ring);
    outline-offset: var(--ring-air);
  }
}

/* Beside a fold, the button's face and ring follow what it draws, the reference line after
   the chevron and the title and the counts under both, and leave the chevron's corner to the
   fold: a box's face and ring took the chevron in, as if it were the epic's. */
.graph-frame-head:not(.overview) .graph-frame-open.folds[data-walk-target] {
  --ring-out: calc(var(--ring-air) + var(--ring));

  position: relative;
  isolation: isolate;

  &:hover,
  &:focus-visible {
    background: transparent;
    outline: none;
  }

  &::before,
  &::after {
    content: '';
    position: absolute;
    pointer-events: none;
  }

  &::before {
    inset: 0;
    z-index: -1;
    clip-path: polygon(
      var(--notch-inline) 0,
      100% 0,
      100% 100%,
      0 100%,
      0 var(--notch-block),
      var(--notch-inline) var(--notch-block)
    );
    border-radius: var(--radius-status);
  }

  &:is(:hover, :focus-visible)::before {
    background: var(--color-surface-hover);
  }

  /* The same outline drawn as a band: the notch's edges, then back round inside it. */
  &::after {
    inset: calc(-1 * var(--ring-out));
    clip-path: polygon(
      var(--notch-inline) 0,
      100% 0,
      100% 100%,
      0 100%,
      0 var(--notch-block),
      var(--notch-inline) var(--notch-block),
      var(--notch-inline) 0,
      calc(var(--notch-inline) + var(--ring)) var(--ring),
      calc(var(--notch-inline) + var(--ring)) calc(var(--notch-block) + var(--ring)),
      var(--ring) calc(var(--notch-block) + var(--ring)),
      var(--ring) calc(100% - var(--ring)),
      calc(100% - var(--ring)) calc(100% - var(--ring)),
      calc(100% - var(--ring)) var(--ring),
      calc(var(--notch-inline) + var(--ring)) var(--ring)
    );
  }

  &:focus-visible::after {
    background: var(--color-focus-ring);

    @media (forced-colors: active) {
      background: Highlight;
      forced-color-adjust: none;
    }
  }
}

/* The reference line steps aside for the chevron; the lines under it do not. */
.graph-frame-open.folds > :first-child {
  padding-inline-start: calc(16px + var(--space-1));
}

/* Up to three lines, and as wide on an open frame as on a folded one, so a title takes
   as many lines either way and the header the same room. */
.graph-frame-title {
  display: -webkit-box;
  color: var(--color-text);
  font: var(--font-row-title);
  overflow-wrap: anywhere;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.graph-frame-inside {
  color: var(--color-text);
  font: var(--font-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Zoomed out, the header is a band that still reads and is easy to hit: its words
   grown with the field, as a zoomed-out card's are, over a thicker edge. The whole
   band is the one button, and its target runs on into the air above and below
   it, which the layout leaves empty: 36px, the least air between two frames, so
   the target stops short of the next header. The work under no epic has no
   reference, and keeps its name instead, and its fold, the one button its header
   has (`foldIsTarget`). */
.graph-frame-head.overview {
  --band-fit: 1;
  --grow: calc(2.2 * var(--band-fit));
  --inside-grow: var(--grow);

  /* The band's first row and how far it grows: the line's, or what a fold hides where that
     stands alone. The chevron leads it as tall as it is, and a ring round one of the band's
     buttons, and its air, keep the share of the words they have at the reading size, 2px
     of 13: kept at that size, far out the ring was a speck beside them (`GraphFrameFold`). */
  --lead-grow: var(--grow);
  --lead-size: calc(var(--font-size-module) * var(--lead-grow));
  --lead-row: calc(var(--lead-size) * var(--line-height-snug));
  --ring-air: calc(var(--lead-size) * 0.15);
  --ring: calc(var(--lead-size) * 0.15);

  /* What a fold reaches over: the whole band (`GraphFrameFold`). */
  position: relative;
  grid-template-rows: minmax(0, 1fr) auto;
  align-content: stretch;

  &.far {
    --grow: calc(3.2 * var(--band-fit));
    --inside-grow: calc(5 * var(--band-fit));
  }

  &.inside-leads {
    --lead-grow: var(--inside-grow);
  }

  .graph-frame-open {
    gap: 0;

    &.folds {
      padding-inline-start: calc(var(--lead-row) + var(--space-1) * var(--lead-grow));

      & > :first-child {
        padding-inline-start: 0;
      }
    }

    &[data-walk-target] {
      position: relative;
      grid-row: 1 / -1;
      place-self: stretch stretch;
      inline-size: auto;
      block-size: auto;

      &::before {
        content: '';
        position: absolute;
        inset: calc(-36px - var(--space-2)) calc(-1 * var(--space-4));
      }
    }

    &:not([data-walk-target]) {
      pointer-events: none;
    }
  }

  .graph-frame-inside {
    display: block;
    flex: 0 0 auto;
    max-width: calc(100% / var(--inside-grow));
    height: calc(1lh * var(--inside-grow));
    font: var(--font-drawer-title);
    font-weight: 700;
    transform: scale(var(--inside-grow));
    transform-origin: left top;
  }

  /* Under the button that spans the band, in its one column, not in a column of its own. */
  .graph-frame-progress {
    grid-area: 2 / 1;
    height: 12px;
    pointer-events: none;
  }
}
</style>
