<script setup lang="ts">
/**
 * The one tooltip of the window: the hint of whichever element the pointer rests on, or
 * the keyboard has just brought focus to (`vTooltip` in `tooltipAnchors.ts`).
 *
 * One popup root serves every hint, as one serves every reference preview: a root per
 * element costs more to mount than a long list can afford. Its trigger is a stub, and the
 * listeners here point the root at the element under the pointer or the focus, so the
 * library's delay, its pass to the next hint, its placement and its close on scroll all
 * run on that element.
 *
 * What the library cannot know is decided here:
 * - The pointer shows a hint after the delay, and the next one at once while one is up. A
 *   finger shows none, and nor does a pointer with a button down: it is dragging.
 * - Focus shows a hint when a key moved it there, as it shows a ring; a press does not. It is
 *   the focused element's own hint or none: a control inside a hinted element is not that
 *   element, and one with a hint of another kind, a why tip's, would raise two at once. Inside
 *   an area (`data-tooltip-area`) it is the area's one hint, which stays where it stands while
 *   focus moves among the area's parts, as it does while the pointer does.
 * - A hint asked for on a side stands there where its lines fit beside its element, else on the
 *   other side, else on the roomier one drawn narrower, down to `NARROWEST_BESIDE`, and above
 *   the element where neither side has that much. Left to the library, a side with no room
 *   squeezed the hint into what room it had, a word a line.
 * - A hint of the `clipped` kind shows only while its text is cut, measured as it would show;
 *   a name and a detail always show. A detail on an element whose own words are cut says
 *   them whole first, on a line of their own, measured the same way; uncut, it is the detail.
 * - A reference's preview wins: no hint shows on a reference, or while its card is up, and
 *   either one opening closes the other.
 * - Escape closes the hint and still does what it does where it was pressed; a press anywhere,
 *   a scroll of what holds the element and a surface opening over it close the hint too. A hint
 *   the pointer was on stays closed until the pointer leaves its element; inside an area, until
 *   it moves onto another of the area's parts, which asks for the area's hint again: the whole of
 *   a chart's period is one element here, and a press on one segment kept the period's hint from
 *   every other segment.
 * - A hint with a structure (`body`) is drawn as a grid (`TooltipBody`), its width estimated from
 *   its widest cells before it opens, and the main row of the part of its area that the pointer or
 *   the keyboard stands on (`data-tooltip-row`) is marked, without opening the hint again.
 * - A pointer at rest is pointing at whatever a scroll brings under it. The browser says so with
 *   a `pointerover` and no move, so that is heard as the pointer's arrival too; and a hint a
 *   scroll closed is asked for again when that scroll ends, for the element the pointer is on.
 */
import { computed, defineComponent, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { useEventListener } from '@vueuse/core'
import {
  injectTooltipRootContext,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui'

import { overlayTop } from '@/shared/ui/overlayStack.ts'
import { previewAnchorOf } from '@/shared/ui/referencePreviewAnchors.ts'
import type { TooltipAlign, TooltipSide } from '@/shared/ui/tooltipAnchors.ts'
import {
  focusAnchorOf,
  inTooltipArea,
  onTooltipAnchorGone,
  textIsClipped,
  tooltipAnchorOf,
  tooltipDescriptions,
  tooltipOf,
  tooltipReachOf,
  tooltipRowOf,
} from '@/shared/ui/tooltipAnchors.ts'
import TooltipBody from '@/shared/ui/TooltipBody.vue'
import { bodyWidth, hintWidth } from '@/shared/ui/tooltipWidth.ts'

let root: ReturnType<typeof injectTooltipRootContext> | null = null

const drawsNothing = () => null

/** The root's context, which only a child of the root can reach. */
const Contexts = defineComponent({
  setup() {
    root = injectTooltipRootContext()
    return drawsNothing
  },
})

const open = ref(false)
/** The element whose hint shows. */
const shown = shallowRef<HTMLElement | null>(null)
const hint = computed(() => (shown.value ? tooltipOf(shown.value) : undefined))
/** The shown element's own words are cut, so its hint says them first. */
const whole = ref(false)
/**
 * What stands between the words and the detail, as an expression: the template compiler drops a
 * space that ends an element, and the hint's text, which is its accessible copy too, read a cut
 * name glued to its share, «part 1» and «32%» as «part 132%». The detail's line starts with it,
 * so it shows nothing.
 */
const apart = ' '
/** What the hint is placed against; the stub trigger stands nowhere. */
const reference = computed(() => shown.value ?? undefined)
/**
 * What assistive technology reads of a hint drawn as a grid: its text, as for every hint. Left to
 * the library, the copy was the grid's cells run together.
 */
const bodyCopy = computed(() =>
  hint.value?.body ? [hint.value.text, hint.value.note].filter(Boolean).join('\n') : undefined,
)

/** The deepest element the pointer is on, and the one focus is on. */
const pointed = shallowRef<Element | null>(null)
const focused = shallowRef<Element | null>(null)
/**
 * The key of the main row the part under the pointer stands for, while the pointer is in the
 * shown hint's area; else that of the part focus is on. Focus a key moves forgets where the
 * pointer was, until it moves again, so the last of the two to move is the one marked.
 */
const current = computed(() => {
  const element = shown.value
  if (!element?.isConnected) return null
  const part = pointed.value
  return part && tooltipReachOf(element).contains(part)
    ? tooltipRowOf(element, part)
    : tooltipRowOf(element, focused.value)
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

/** The element the root is pointed at. */
let anchor: HTMLElement | null = null
/** The element the pointer is on: it opens once, until the pointer has left it. */
let hovered: HTMLElement | null = null
/**
 * The part of an area the pointer was on when a press or Escape closed the area's hint: the hint
 * stays closed while the pointer rests there, and another part of the area asks for it again.
 */
let dismissedOn: Element | null = null
/** A key, not a press, was the last input, so focus that moves is the reader's own. */
let keyed = false
/** Focus is what holds the hint up, not the pointer. */
let heldByFocus = false
/** A scroll event is on its way through the window, from what scrolled. */
let scrolling: EventTarget | null = null
/**
 * What scrolled and closed the hint the pointer was on, until its scroll ends. The scroll that
 * closes a hint can be the one that brought the element under the pointer, its event a frame
 * behind the pointer's arrival, and a pointer at rest gives no other sign that it is still there.
 */
let closedBy: EventTarget | null = null

/** A reference's card is up: it is a popup of the same library, and the reader's. */
const previewUp = () => document.querySelector('.reference-preview') !== null

function shows(element: HTMLElement) {
  const tooltip = tooltipOf(element)
  return !tooltip || previewAnchorOf(element) || previewUp()
    ? false
    : !tooltip.clipped || textIsClipped(element)
}

/**
 * The hint that speaks for the element the pointer is on: its own, or, while its own is a
 * `clipped` hint of words that stand whole, the hint of what holds it. A one-line word inside a
 * control that has a hint of its own took the pointer from that hint everywhere it stood whole.
 */
function speakerOf(element: HTMLElement | null): HTMLElement | null {
  let speaker = element
  while (speaker && tooltipOf(speaker)?.clipped && !textIsClipped(speaker)) {
    const holder = tooltipAnchorOf(speaker.parentElement)
    // Inside an area its one hint holds every part, its own element too.
    if (holder === speaker) break
    speaker = holder
  }
  return speaker ?? element
}

function pointAt(element: HTMLElement) {
  if (anchor === element) return
  anchor = element
  heldByFocus = false
  root?.onTriggerChange(element)
}

/** What the root asks for. Closing goes through; opening needs a reader behind it. */
function request(next: boolean) {
  if (!next) {
    // A Tab scrolls the element it lands on into view, and that is no reason to close.
    if (scrolling && heldByFocus) return
    if (scrolling && open.value) closedBy = scrolling
    heldByFocus = false
    open.value = false
    return
  }
  const element = heldByFocus ? anchor : speakerOf(anchor)
  if (!element?.isConnected || !shows(element)) return
  const reached = heldByFocus
    ? focusAnchorOf(document.activeElement) === element
    : tooltipReachOf(element).matches(':hover')
  if (!reached) return
  const tooltip = tooltipOf(element)
  shown.value = element
  whole.value = Boolean(tooltip?.words) && textIsClipped(element)
  const words = whole.value ? [tooltip?.words ?? ''] : []
  const lines = [...words, ...(tooltip?.text ?? '').split('\n'), tooltip?.note ?? '']
  place.value = placeOf(element, tooltip?.body ? bodyWidth(tooltip.body) : hintWidth(lines))
  open.value = true
}

/**
 * Closes the hint for one of the host's own reasons, a press or Escape among them: that close
 * stands past the end of a scroll.
 */
function close() {
  closedBy = null
  root?.onClose()
}

/**
 * A press or Escape closes the hint; inside an area, where the pointer is (`part`) is noted, so
 * that another part asks for the area's hint again. Elsewhere the hint waits for the pointer to
 * leave its element, as it always has.
 */
function dismiss(part: EventTarget | null) {
  dismissedOn = hovered && inTooltipArea(hovered) && part instanceof Element ? part : null
  close()
}

function leave() {
  hovered = null
  dismissedOn = null
  root?.onTriggerLeave()
}

/** The pointer is on `element`, from now on: it asks for its hint, after the delay. */
function enter(element: HTMLElement) {
  if (previewAnchorOf(element)) return
  pointAt(element)
  root?.onTriggerEnter()
}

/** The pointer moved, or a scroll or a change of the page put another element under it. */
function point(event: PointerEvent) {
  if (event.pointerType === 'touch') return
  if (event.target instanceof Element) pointed.value = event.target
  if (event.buttons !== 0) {
    if (open.value && !heldByFocus) close()
    return
  }
  const element = tooltipAnchorOf(event.target)
  if (element === hovered) {
    // Another part of the area whose hint a press or Escape closed: its hint, asked for again.
    if (element && dismissedOn && event.target !== dismissedOn) {
      dismissedOn = null
      enter(element)
    }
    return
  }
  if (hovered) leave()
  if (!element) return
  hovered = element
  enter(element)
}

useEventListener(document, 'pointerover', point, { capture: true })
useEventListener(document, 'pointermove', point, { capture: true })
useEventListener(
  document,
  'pointerout',
  (event: PointerEvent) => {
    const element = tooltipAnchorOf(event.target)
    if (element && element === hovered && tooltipAnchorOf(event.relatedTarget) !== element) leave()
  },
  { capture: true },
)
useEventListener(
  document,
  'pointerdown',
  (event: PointerEvent) => {
    keyed = false
    if (open.value) dismiss(event.target)
  },
  { capture: true },
)
useEventListener(
  document,
  'keydown',
  () => {
    keyed = true
  },
  { capture: true },
)
useEventListener(document, 'focusin', (event: FocusEvent) => {
  focused.value = event.target instanceof Element ? event.target : null
  // Focus a key moved is where the reader stands now, not where the pointer rests.
  if (keyed) pointed.value = null
  const element = focusAnchorOf(event.target)
  if (!element || !keyed) return
  pointAt(element)
  heldByFocus = true
  root?.onOpen()
})
useEventListener(document, 'focusout', (event: FocusEvent) => {
  focused.value = null
  const element = focusAnchorOf(event.target)
  if (!element || element !== anchor || !heldByFocus) return
  // Focus moving among the parts of the element's area keeps its hint where it stands.
  if (focusAnchorOf(event.relatedTarget) === element) return
  heldByFocus = false
  close()
})
// Either side of the library's own listener, which closes the hint on a scroll of anything
// holding its element: the event goes through the window before it reaches the document.
useEventListener(
  window,
  'scroll',
  (event: Event) => {
    scrolling = event.target
  },
  { capture: true, passive: true },
)
useEventListener(
  document,
  'scroll',
  () => {
    scrolling = null
  },
  { capture: true, passive: true },
)
// The scroll that closed the hint is over, and the pointer rests on what it left under it.
useEventListener(
  document,
  'scrollend',
  (event: Event) => {
    if (!closedBy || event.target !== closedBy) return
    closedBy = null
    if (hovered?.isConnected && !open.value) enter(hovered)
  },
  { capture: true, passive: true },
)
// Escape closes the hint on its way and goes on to what it was pressed for: a hint stands
// over every control the keyboard reaches, and taking the key would make each Escape that
// folds a list or closes a panel a second press.
useEventListener(
  () => (open.value ? window : null),
  'keydown',
  (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing) return
    heldByFocus = false
    dismiss(pointed.value)
  },
  { capture: true },
)

watch(overlayTop, close)

const stopHearing = onTooltipAnchorGone((element) => {
  if (element === hovered) hovered = null
  if (element !== anchor && element !== shown.value) return
  if (element === anchor) anchor = null
  heldByFocus = false
  close()
})
onBeforeUnmount(stopHearing)
</script>

<template>
  <!-- A hint is never entered (it lets the pointer through), so the library keeps no way open
       to it: that way, the room between an element and its hint, held off the next element's
       hint while the pointer stood in it, and a word beside a cut word showed none. -->
  <TooltipProvider
    :delay-duration="500"
    :skip-delay-duration="300"
    disable-hoverable-content
  >
    <TooltipRoot
      :open="open"
      @update:open="request"
    >
      <Contexts />
      <TooltipTrigger
        :reference="reference"
        as-child
      >
        <span hidden />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          v-if="hint"
          class="tooltip-hint"
          :class="{ 'tooltip-hint-body': hint.body }"
          :aria-label="bodyCopy"
          :align="place.align"
          :side="place.side"
          :side-offset="OFFSET"
          :collision-padding="EDGE"
          :style="widestStyle"
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
          >
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
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
/* A hint is read, never pressed: a press where it stands lands on what it covers. One the
   keyboard held up took a finger's tap inside the reach of the control below it. Its
   placement wrapper is the library's and as large as the hint, so it lets the pointer
   through as well. */
[data-reka-popper-content-wrapper]:has(> .tooltip-hint),
.tooltip-hint {
  pointer-events: none;
}

.tooltip-hint {
  /* The widest a hint is drawn (`WIDEST`); beside an element with less room, the host's less. */
  --tooltip-widest: 20rem;

  z-index: 120;
  max-inline-size: min(var(--tooltip-widest), var(--reka-tooltip-content-available-width));
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-tooltip-border);
  color: var(--color-tooltip-text);
  font: var(--font-note);
  overflow-wrap: anywhere;
  white-space: pre-line;
  background: var(--color-tooltip-surface);
  border-radius: var(--radius-status);
  box-shadow: 0 8px 24px var(--color-shadow);
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
