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
 *   a scroll of what holds the element and a surface opening over it close the hint too.
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

import { drawnWidth } from '@/shared/lib/textWidth.ts'
import { overlayTop } from '@/shared/ui/overlayStack.ts'
import { previewAnchorOf } from '@/shared/ui/referencePreviewAnchors.ts'
import type { TooltipAlign, TooltipSide } from '@/shared/ui/tooltipAnchors.ts'
import {
  focusAnchorOf,
  onTooltipAnchorGone,
  textIsClipped,
  tooltipAnchorOf,
  tooltipDescriptions,
  tooltipOf,
  tooltipReachOf,
} from '@/shared/ui/tooltipAnchors.ts'

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

/**
 * How wide the hint's lines are drawn, its padding and its border (`.tooltip-hint`) included:
 * its element's own words first while they are cut, its text, its note.
 */
function hintWidth(lines: readonly string[]): number {
  const root = getComputedStyle(document.documentElement)
  const font = root.getPropertyValue('--font-note').trim()
  const inset = 2 * ((Number.parseFloat(root.getPropertyValue('--space-2')) || 0) + 1)
  return Math.max(0, ...lines.map((line) => drawnWidth(line, font))) + inset
}

/** Where the hint of `element` stands: on the side it asks for, or where it has room. */
function placeOf(element: HTMLElement, lines: readonly string[]): Place {
  const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  const { align = 'center', side = 'top' } = tooltipOf(element) ?? {}
  if (side !== 'left' && side !== 'right') return { align, side }
  const box = element.getBoundingClientRect()
  const room = {
    left: box.left - OFFSET - EDGE,
    right: document.documentElement.clientWidth - box.right - OFFSET - EDGE,
  }
  const other = side === 'left' ? 'right' : 'left'
  const need = Math.min(WIDEST * rem, hintWidth(lines))
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
  place.value = placeOf(element, lines)
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

function leave() {
  hovered = null
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
  if (event.buttons !== 0) {
    if (open.value && !heldByFocus) close()
    return
  }
  const element = tooltipAnchorOf(event.target)
  if (element === hovered) return
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
  () => {
    keyed = false
    if (open.value) close()
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
  const element = focusAnchorOf(event.target)
  if (!element || !keyed) return
  pointAt(element)
  heldByFocus = true
  root?.onOpen()
})
useEventListener(document, 'focusout', (event: FocusEvent) => {
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
    close()
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
          :align="place.align"
          :side="place.side"
          :side-offset="OFFSET"
          :collision-padding="EDGE"
          :style="widestStyle"
          hide-when-detached
        >
          <template v-if="whole && hint.words">
            <span class="tooltip-words">{{ hint.words }}</span
            >{{ apart }} </template
          >{{ hint.text
          }}<span
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
