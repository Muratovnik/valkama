<script setup lang="ts">
/**
 * The one tooltip of the window: the surface that draws the hint of `v-tooltip`
 * (`tooltipAnchors.ts`) against whichever element the hint manager (`hintManager.ts`) shows it
 * for. When a hint shows and when it goes are the manager's; what it says and where it stands are
 * decided here.
 *
 * The surface is the library's hover-card content, one root for every hint, held open by the
 * manager and placed through its documented `reference` prop. A probe of reka-ui 2.11.0 found that
 * this content follows a new `reference` on the first frame without remounting, takes no role,
 * adds no focus guards and moves no focus, and that its own requests to close, on Escape or a
 * press outside it, change nothing on a root whose `open` is held, so the manager's rules are the
 * only ones. The tooltip's content has no `reference` prop, and the popover's is a dialog with
 * focus guards at the ends of the page; neither suits a hint. Nothing here reaches into the
 * library's internal context.
 *
 * What the manager does not decide is decided here:
 * - Where a hint stands is its kind's, its mark's and its list's (`hintPlacement.ts`), asked as
 *   it opens; the library keeps it inside the window from there, a hint aside of a list or at a
 *   mark read against a box that follows its row or its mark as the page moves.
 * - A hint of the `clipped` kind is not drawn here: its words are laid whole over the cut ones
 *   (`WholeText`), the second surface of this host. Words hidden whole, as an icon rail's labels,
 *   show no letter to lay them from, and are drawn here, placed as a name. A name and a detail
 *   always show. A detail on an element whose own words are cut says them whole first, on a line
 *   of their own, measured as it would show; uncut, it is the detail.
 * - A reference's preview wins on a reference: no hint is found there. The card is a surface of
 *   the same manager, so it and a hint replace each other as any two hints do.
 * - A hint the pointer raised can be entered by the pointer. One the keyboard holds up lets a
 *   press through to what it covers, since it stands over every control the keyboard reaches,
 *   and one at a chart's mark lets the pointer through, since it follows the pointer from mark to
 *   mark, standing over the marks beside its own.
 * - A hint of words is a tooltip itself and holds its words once; a hint drawn as a grid keeps
 *   its text, for assistive technology alone, beside a grid drawn for the eye alone. The element
 *   is described by its hint through the hidden copies under this host, whether or not it shows.
 * - A hint fades in after the pointer's rest; passing on from a neighbour, or brought by a key,
 *   it is already there, as the reference's card is.
 * - A hint with a structure (`body`) is drawn as a grid (`TooltipBody`), its width estimated from
 *   its widest cells before it opens, and the main row of the part of its area that the pointer or
 *   the keyboard stands on (`data-tooltip-row`) is marked, without opening the hint again.
 */
import { computed, ref, shallowRef, watch } from 'vue'

import { HoverCardContent, HoverCardPortal, HoverCardRoot, VisuallyHidden } from 'reka-ui'

import { focusedPart, pointedPart, shownHint, useHintKind } from '@/shared/ui/hintManager.ts'
import { EDGE, hintPlaceOf, OFFSET } from '@/shared/ui/hintPlacement.ts'
import { previewAnchorOf } from '@/shared/ui/referencePreviewAnchors.ts'
import {
  focusAnchorOf,
  inTooltipArea,
  namesHidden,
  pointerAnchorOf,
  showsWhole,
  textIsClipped,
  tooltipDescriptions,
  tooltipOf,
  tooltipReachOf,
  tooltipRowOf,
} from '@/shared/ui/tooltipAnchors.ts'
import TooltipBody from '@/shared/ui/TooltipBody.vue'
import { bodyWidth, hintWidth } from '@/shared/ui/tooltipWidth.ts'
import WholeText from '@/shared/ui/WholeText.vue'

/** The element whose hint an event's target asks for, unless its hint is its words whole. */
const besideOf = (anchor: HTMLElement | null) => (anchor && !showsWhole(anchor) ? anchor : null)

useHintKind('tooltip', {
  pointedAnchor: (target) => (previewAnchorOf(target) ? null : besideOf(pointerAnchorOf(target))),
  focusedAnchor: (target) => (previewAnchorOf(target) ? null : besideOf(focusAnchorOf(target))),
  // Words hidden whole show only while they are hidden: a width that shows them takes it down.
  shows: (anchor) =>
    tooltipOf(anchor)?.clipped === true
      ? namesHidden(anchor) && textIsClipped(anchor)
      : tooltipOf(anchor) !== undefined,
  isArea: inTooltipArea,
  // A hint the pointer passes through is never entered, so nothing holds it on the way there.
  reachable: () =>
    passedThrough.value
      ? null
      : (document.querySelector('.tooltip-hint')?.getBoundingClientRect() ?? null),
})

/** This kind's hint, while the manager shows one. */
const mine = computed(() => (shownHint.value?.kind === 'tooltip' ? shownHint.value : null))
/** The element whose hint shows. */
const shown = computed(() => mine.value?.anchor ?? null)
const hint = computed(() => (shown.value ? tooltipOf(shown.value) : undefined))
const open = computed(() => hint.value !== undefined)
/**
 * How the hint opened: after the pointer's rest, when it fades in, or at once, passing on from a
 * neighbour or brought by a key, when it is already there.
 */
const opened = computed(() => (mine.value?.rested ? 'after-rest' : 'at-once'))
/** Where the shown hint stands and what it stands against, decided as it opens. */
const place = shallowRef<ReturnType<typeof hintPlaceOf> | null>(null)

/**
 * The pointer and a press go through the hint rather than onto it: a hint focus a key brought
 * stands over every control the keyboard reaches, and one at a chart's mark (`hintPlacement.ts`)
 * follows the pointer along the chart, standing over the marks beside its own: the periods that
 * come next, the rows under a ranked row, the steps of the readings after a reading, a
 * neighbouring small chart. Every other hint the pointer raised can be entered.
 */
const passedThrough = computed(() => {
  const now = mine.value
  return (
    now !== null && (now.by === 'focus' || inTooltipArea(now.anchor) || place.value?.mark === true)
  )
})
/** The shown element's own words are cut, so its hint says them first. */
const whole = ref(false)
/**
 * What stands between the words and the detail, as an expression: the template compiler drops a
 * space that ends an element, and the hint's text, which assistive technology reads too, read a
 * cut name glued to its share, «part 1» and «32%» as «part 132%». The detail's line starts with
 * it, so it shows nothing.
 */
const apart = ' '
/**
 * What assistive technology reads of a hint drawn as a grid: its text, rather than the grid's
 * cells run together, which are drawn for the eye alone. A hint of words is its own tooltip and
 * reads as it shows: a copy of them beside the words once said every hint twice.
 */
const copy = computed(() =>
  hint.value?.body ? [hint.value.text, hint.value.note].filter(Boolean).join('\n') : '',
)
/** A hint of words is the tooltip itself; a grid's tooltip is its copy. */
const role = computed(() => (hint.value?.body ? undefined : 'tooltip'))
/** A grid's note is in its copy, so as drawn it is for the eye alone. */
const noteHidden = computed(() => (hint.value?.body ? 'true' : undefined))

/**
 * The key of the main row the part under the pointer stands for, while the pointer is in the
 * shown hint's area; else that of the part focus is on. Focus a key moves forgets where the
 * pointer was, until it moves again, so the last of the two to move is the one marked.
 */
const current = computed(() => {
  const element = shown.value
  if (!element?.isConnected) return null
  const part = pointedPart.value
  return part && tooltipReachOf(element).contains(part)
    ? tooltipRowOf(element, part)
    : tooltipRowOf(element, focusedPart.value)
})

/** What the hint is placed against: its element, or the box aside of the list it stands in. */
const reference = computed(() => (shown.value ? place.value?.reference : undefined))

/** The hint's widest where its place draws it other than `WIDEST` wide. */
const widestStyle = computed(() =>
  place.value?.widest ? { '--tooltip-widest': `${place.value.widest}px` } : undefined,
)

// As a hint opens on an element, measured then: whether its words are cut, and where it stands.
watch(shown, (element) => {
  const tooltip = element ? tooltipOf(element) : undefined
  if (!element || !tooltip) return
  whole.value = Boolean(tooltip.words) && textIsClipped(element)
  const words = whole.value ? [tooltip.words] : []
  const lines = [...words, ...tooltip.text.split('\n'), tooltip.note]
  const width = tooltip.body ? bodyWidth(tooltip.body) : hintWidth(lines)
  // Words hidden whole name an icon that stands alone, as a name does.
  const kind = tooltip.clipped ? 'name' : tooltip.kind
  place.value = hintPlaceOf(element, { asked: tooltip.asked, kind }, width)
})
</script>

<template>
  <HoverCardRoot :open="open">
    <HoverCardPortal>
      <HoverCardContent
        v-if="hint"
        class="tooltip-hint"
        :class="{ 'tooltip-hint-body': hint.body, 'tooltip-hint-through': passedThrough }"
        :reference="reference"
        :align="place?.align"
        :side="place?.side"
        :side-offset="OFFSET"
        :collision-padding="EDGE"
        :style="widestStyle"
        :data-opened="opened"
        :role="role"
        data-hint-surface
        hide-when-detached
      >
        <TooltipBody
          v-if="hint.body"
          aria-hidden="true"
          :body="hint.body"
          :current="current"
        />
        <template v-else>
          <template v-if="whole && hint.words">
            <span class="tooltip-words">{{ hint.words }}</span
            >{{ apart }} </template
          >{{ hint.text }}</template
        ><span
          v-if="hint.note"
          class="tooltip-note"
          :aria-hidden="noteHidden"
        >
          {{ hint.note }}</span
        ><VisuallyHidden
          v-if="hint.body"
          role="tooltip"
          >{{ copy }}</VisuallyHidden
        >
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
  <WholeText />
  <!-- The words each element is described by, whether or not its hint shows. -->
  <div hidden>
    <span
      v-for="[id, text] in tooltipDescriptions"
      :id="id"
      :key="id"
      >{{ text }}</span
    >
  </div>
</template>

<!-- The hint is portalled out of this component, so its surface is not scoped. -->
<style>
/* The library's placement wrapper is as large as the hint, so the pointer is on the hint or on
   what the hint does not cover, never on the wrapper. */
[data-reka-popper-content-wrapper]:has(> .tooltip-hint) {
  pointer-events: none;
}

.tooltip-hint {
  /* The widest a hint is drawn (`WIDEST` in `hintPlacement.ts`); beside a list with less room,
     the host's less, and in a wide row the room beside its element. */
  --tooltip-widest: 20rem;

  /* Over the menus and sheets (120) whose rows it speaks for, as a cut text's whole words are. */
  z-index: 130;
  max-inline-size: min(var(--tooltip-widest), var(--reka-hover-card-content-available-width));
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-tooltip-border);
  color: var(--color-tooltip-text);
  font: var(--font-note);
  overflow-wrap: anywhere;
  white-space: pre-line;
  background: var(--color-tooltip-surface);
  border-radius: var(--radius-status);
  box-shadow: 0 8px 24px var(--color-shadow);

  /* A hint the pointer raised can be entered, and stays while the pointer is on it. */
  pointer-events: auto;

  /* It fades in after the rest; passing on from a neighbour, or brought by a key, it is already
     there and does not appear again, as the reference's card does. */
  &[data-opened='after-rest'] {
    animation: tooltip-hint-appear var(--duration-quick) var(--ease-out);
  }
}

@keyframes tooltip-hint-appear {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tooltip-hint[data-opened='after-rest'] {
    animation: none;
  }
}

/* A hint the keyboard holds up, and a chart period's, are read, never pressed or entered: a press
   or the pointer where one stands lands on what it covers. One the keyboard held up took a
   finger's tap inside the reach of the control below. */
.tooltip-hint-through {
  pointer-events: none;
}

/* A hint drawn as a grid: its rows carry the rest of the inset, so a row's band reaches past
   its words (`TooltipBody`). */
.tooltip-hint-body {
  padding-inline: var(--space-1);
}

/* The element's own words, whole while it shows them cut: their own line, over the detail. */
.tooltip-words {
  display: block;
}

/* A state under the action it qualifies: its own line, in the quiet ink. */
.tooltip-note {
  display: block;
  color: var(--color-text-muted);
}
</style>
