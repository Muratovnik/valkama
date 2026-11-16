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
 * - A hint asked for on a side stands there where its lines fit beside its element, else on the
 *   other side, else on the roomier one drawn narrower, down to `NARROWEST_BESIDE`, and above
 *   the element where neither side has that much. Left to the library, a side with no room
 *   squeezed the hint into what room it had, a word a line.
 * - A hint of the `clipped` kind shows only while its text is cut, measured as it would show;
 *   a name and a detail always show. A detail on an element whose own words are cut says
 *   them whole first, on a line of their own, measured the same way; uncut, it is the detail.
 * - A reference's preview wins on a reference: no hint is found there. The card is a surface of
 *   the same manager, so it and a hint replace each other as any two hints do.
 * - A hint the pointer raised can be entered by the pointer. One the keyboard holds up lets a
 *   press through to what it covers, since it stands over every control the keyboard reaches,
 *   and a chart period's lets the pointer through, since it follows the pointer along the plot.
 * - A hint with a structure (`body`) is drawn as a grid (`TooltipBody`), its width estimated from
 *   its widest cells before it opens, and the main row of the part of its area that the pointer or
 *   the keyboard stands on (`data-tooltip-row`) is marked, without opening the hint again.
 */
import { computed, ref, watch } from 'vue'

import { HoverCardContent, HoverCardPortal, HoverCardRoot, VisuallyHidden } from 'reka-ui'

import { focusedPart, pointedPart, shownHint, useHintKind } from '@/shared/ui/hintManager.ts'
import { previewAnchorOf } from '@/shared/ui/referencePreviewAnchors.ts'
import type { TooltipAlign, TooltipSide } from '@/shared/ui/tooltipAnchors.ts'
import {
  focusAnchorOf,
  inTooltipArea,
  pointerAnchorOf,
  textIsClipped,
  tooltipDescriptions,
  tooltipOf,
  tooltipReachOf,
  tooltipRowOf,
} from '@/shared/ui/tooltipAnchors.ts'
import TooltipBody from '@/shared/ui/TooltipBody.vue'
import { bodyWidth, hintWidth } from '@/shared/ui/tooltipWidth.ts'

useHintKind('tooltip', {
  pointedAnchor: (target) => (previewAnchorOf(target) ? null : pointerAnchorOf(target)),
  focusedAnchor: (target) => (previewAnchorOf(target) ? null : focusAnchorOf(target)),
  shows(anchor) {
    const tooltip = tooltipOf(anchor)
    return Boolean(tooltip) && (!tooltip?.clipped || textIsClipped(anchor))
  },
  isArea: inTooltipArea,
})

/** This kind's hint, while the manager shows one. */
const mine = computed(() => (shownHint.value?.kind === 'tooltip' ? shownHint.value : null))
/** The element whose hint shows. */
const shown = computed(() => mine.value?.anchor ?? null)
const hint = computed(() => (shown.value ? tooltipOf(shown.value) : undefined))
const open = computed(() => hint.value !== undefined)
/** What the hint is placed against. */
const reference = computed(() => shown.value ?? undefined)
/**
 * The pointer and a press go through the hint rather than onto it: a hint focus a key brought
 * stands over every control the keyboard reaches, and a chart period's follows the pointer along
 * the plot, standing beside its column over the periods that come next. Every other hint the
 * pointer raised can be entered.
 */
const passedThrough = computed(() => {
  const now = mine.value
  return now !== null && (now.by === 'focus' || inTooltipArea(now.anchor))
})
/** The shown element's own words are cut, so its hint says them first. */
const whole = ref(false)
/**
 * What stands between the words and the detail, as an expression: the template compiler drops a
 * space that ends an element, and the hint's text, which is its accessible copy too, read a cut
 * name glued to its share, «part 1» and «32%» as «part 132%». The detail's line starts with it,
 * so it shows nothing.
 */
const apart = ' '
/**
 * What assistive technology reads of the hint, as the library's tooltip gave it: the words it
 * shows, and for a hint drawn as a grid its text rather than the grid's cells run together.
 */
const copy = computed(() => {
  const tooltip = hint.value
  if (!tooltip) return ''
  if (tooltip.body) return [tooltip.text, tooltip.note].filter(Boolean).join('\n')
  return [whole.value ? tooltip.words : '', tooltip.text, tooltip.note].filter(Boolean).join(' ')
})

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

/**
 * The widest a hint is drawn, as `--tooltip-widest` says in `.tooltip-hint`, and the narrowest it
 * is drawn beside its element, in rem.
 */
const WIDEST = 20
const NARROWEST_BESIDE = 12
/** The room between a hint and its element, and between a hint and the window's edge, in px. */
const OFFSET = 6
const EDGE = 8

interface Place {
  align: TooltipAlign
  side: TooltipSide
  /** How wide the hint is drawn at most where it stands, in px, where narrower than `WIDEST`. */
  widest?: number
}

/** Where the shown hint stands, decided as it opens. */
const place = ref<Place>({ align: 'center', side: 'top' })

/** Where the hint of `element` stands, `width` wide: on the side it asks for, or where it has room. */
function placeOf(element: HTMLElement, width: number): Place {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const { align = 'center', side = 'top' } = tooltipOf(element) ?? {}
  if (side !== 'left' && side !== 'right') return { align, side }
  const box = element.getBoundingClientRect()
  const room = {
    left: box.left - OFFSET - EDGE,
    right: document.documentElement.clientWidth - box.right - OFFSET - EDGE,
  }
  const other = side === 'left' ? 'right' : 'left'
  const need = Math.min(WIDEST * rem, width)
  if (room[side] >= need) return { align, side }
  if (room[other] >= need) return { align, side: other }
  const roomier = room[other] > room[side] ? other : side
  return room[roomier] >= NARROWEST_BESIDE * rem
    ? { align, side: roomier, widest: room[roomier] }
    : { align: 'center', side: 'top' }
}

/** The hint's widest where its place draws it narrower than `WIDEST`. */
const widestStyle = computed(() =>
  place.value.widest ? { '--tooltip-widest': `${place.value.widest}px` } : undefined,
)

// As a hint opens on an element, measured then: whether its words are cut, and where it stands.
watch(shown, (element) => {
  const tooltip = element ? tooltipOf(element) : undefined
  if (!element || !tooltip) return
  whole.value = Boolean(tooltip.words) && textIsClipped(element)
  const words = whole.value ? [tooltip.words] : []
  const lines = [...words, ...tooltip.text.split('\n'), tooltip.note]
  place.value = placeOf(element, tooltip.body ? bodyWidth(tooltip.body) : hintWidth(lines))
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
        :align="place.align"
        :side="place.side"
        :side-offset="OFFSET"
        :collision-padding="EDGE"
        :style="widestStyle"
        data-hint-surface
        hide-when-detached
      >
        <TooltipBody
          v-if="hint.body"
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
        >
          {{ hint.note }}</span
        ><VisuallyHidden role="tooltip">{{ copy }}</VisuallyHidden>
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
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
  /* The widest a hint is drawn (`WIDEST`); beside an element with less room, the host's less. */
  --tooltip-widest: 20rem;

  z-index: 120;
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
