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
 *   element, and one with a hint of another kind, a why tip's, would raise two at once.
 * - A hint in `clipped` mode shows only while its text is cut, measured as it would show.
 * - A reference's preview wins: no hint shows on a reference, or while its card is up, and
 *   either one opening closes the other.
 * - Escape closes the hint and still does what it does where it was pressed; a press anywhere,
 *   a scroll of what holds the element and a surface opening over it close the hint too.
 */
import { computed, defineComponent, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

import { useEventListener } from '@vueuse/core'
import {
  injectTooltipProviderContext,
  injectTooltipRootContext,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from 'reka-ui'

import { overlayTop } from '@/shared/ui/overlayStack.ts'
import { previewAnchorOf } from '@/shared/ui/referencePreviewAnchors.ts'
import {
  onTooltipAnchorGone,
  textIsClipped,
  tooltipAnchorOf,
  tooltipDescriptions,
  tooltipOf,
} from '@/shared/ui/tooltipAnchors.ts'

let root: ReturnType<typeof injectTooltipRootContext> | null = null
let provider: ReturnType<typeof injectTooltipProviderContext> | null = null

const drawsNothing = () => null

/** The root's and the provider's contexts, which only a child of the root can reach. */
const Contexts = defineComponent({
  setup() {
    root = injectTooltipRootContext()
    provider = injectTooltipProviderContext()
    return drawsNothing
  },
})

const open = ref(false)
/** The element whose hint shows. */
const shown = shallowRef<HTMLElement | null>(null)
const hint = computed(() => (shown.value ? tooltipOf(shown.value) : undefined))
/** What the hint is placed against; the stub trigger stands nowhere. */
const reference = computed(() => shown.value ?? undefined)

/** The element the root is pointed at. */
let anchor: HTMLElement | null = null
/** The element the pointer is on: it opens once, until the pointer has left it. */
let hovered: HTMLElement | null = null
/** A key, not a press, was the last input, so focus that moves is the reader's own. */
let keyed = false
/** Focus is what holds the hint up, not the pointer. */
let heldByFocus = false
/** A scroll event is on its way through the window. */
let scrolling = false

/** A reference's card is up: it is a popup of the same library, and the reader's. */
const previewUp = () => document.querySelector('.reference-preview') !== null

function shows(element: HTMLElement) {
  const tooltip = tooltipOf(element)
  return !tooltip || previewAnchorOf(element) || previewUp()
    ? false
    : !tooltip.clipped || textIsClipped(element)
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
    heldByFocus = false
    open.value = false
    return
  }
  const element = anchor
  if (!element?.isConnected || !shows(element)) return
  const reached = heldByFocus ? element === document.activeElement : element.matches(':hover')
  if (!reached) return
  shown.value = element
  open.value = true
}

function close() {
  root?.onClose()
}

function leave() {
  hovered = null
  root?.onTriggerLeave()
}

useEventListener(
  document,
  'pointermove',
  (event: PointerEvent) => {
    if (event.pointerType === 'touch') return
    if (event.buttons !== 0) {
      if (open.value && !heldByFocus) close()
      return
    }
    const element = tooltipAnchorOf(event.target)
    if (element === hovered) return
    if (hovered) leave()
    // The library swaps this ref as the hint mounts, so it is read through its context.
    if (!element || provider?.isPointerInTransitRef.value) return
    hovered = element
    if (previewAnchorOf(element)) return
    pointAt(element)
    root?.onTriggerEnter()
  },
  { capture: true },
)
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
/** The element focus is on, when it has a hint of its own. */
const focusedAnchor = (target: EventTarget | null) => {
  const element = tooltipAnchorOf(target)
  return element === target ? element : null
}

useEventListener(document, 'focusin', (event: FocusEvent) => {
  const element = focusedAnchor(event.target)
  if (!element || !keyed) return
  pointAt(element)
  heldByFocus = true
  root?.onOpen()
})
useEventListener(document, 'focusout', (event: FocusEvent) => {
  const element = focusedAnchor(event.target)
  if (!element || element !== anchor || !heldByFocus) return
  heldByFocus = false
  close()
})
// Either side of the library's own listener, which closes the hint on a scroll of anything
// holding its element: the event goes through the window before it reaches the document.
useEventListener(
  window,
  'scroll',
  () => {
    scrolling = true
  },
  { capture: true, passive: true },
)
useEventListener(
  document,
  'scroll',
  () => {
    scrolling = false
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
  <TooltipProvider
    :delay-duration="500"
    :skip-delay-duration="300"
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
          align="center"
          :side="hint.side"
          :side-offset="6"
          :collision-padding="8"
          hide-when-detached
        >
          {{ hint.text }}
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
  z-index: 120;
  max-inline-size: min(20rem, var(--reka-tooltip-content-available-width));
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
</style>
