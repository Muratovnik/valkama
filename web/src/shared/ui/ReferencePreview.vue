<script setup lang="ts">
/**
 * The one preview of the window: the card that shows while the pointer rests on a
 * reference in text, or while a Tab holds focus on it.
 *
 * One popup root serves every reference, because a root per reference cost more to
 * mount than a long report can afford. So the popup's trigger is a stub, and the
 * listeners here point the root at whichever reference the pointer or the focus is
 * on: its delay, its pass to the next reference, the area that lets the pointer
 * reach the card and the close on scroll all run on that element. The popup library
 * documents none of this retargeting, and the browser checks are what hold it.
 *
 * What the library cannot know is decided here:
 * - Escape closes the card and nothing else. The overlay stack hears the key on the
 *   document, ahead of the library, so it is taken at the window while a card is open.
 * - Focus an overlay gives back on closing is the place returning, not a choice of
 *   this reference, and the card stays closed. Only a Tab opens it from the keyboard.
 * - A surface opening over the card closes it: `Ctrl+K` does not move the pointer, so
 *   the reference would never hear it leave.
 * - A press inside the card leaves focus where it was: focus leaving an overlay's surface
 *   would let the next Tab out from behind its backdrop. A browser moves focus as a press
 *   starts a selection, and refusing the press refused the selection too, so a press on text
 *   goes through and focus goes back: when the press ends with nothing selected, otherwise
 *   at the next Tab or as the card closes, since a text field taking focus would clear what
 *   the reader just selected. A press on a control is refused, so no focus moves at all.
 * - A selection holds the card up. While the press that makes it is down the card does not
 *   close, wherever the pointer goes, and once made it stays until the reader's own press
 *   elsewhere, Escape or a scroll: a card closing under a pointer on its way to nothing would
 *   take the selection with it.
 * - The pointer on the card keeps it, whatever reference lies under it. The library closes a
 *   card for standing over another reference, and that one then took the card from under the
 *   pointer, so a card was out of reach wherever text went on below the reference. The rule
 *   runs as the pointer moves on the card, and nothing else that closes a card does.
 * - Tab goes from the reference through the card's controls and on from the reference, since
 *   the card is portalled away from it and the document's own order would never reach them.
 *
 * A preview that has to read waits for its answer a moment before it shows, so a
 * quick answer is never preceded by a line saying it is on its way.
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

import type { ReferencePreview } from '@/shared/lib/referenceLinks.ts'
import { overlayTop } from '@/shared/ui/overlayStack.ts'
import {
  onPreviewAnchorGone,
  previewAnchorOf,
  previewOf,
} from '@/shared/ui/referencePreviewAnchors.ts'

/** How long a preview that reads may hold the card back before it shows what it has. */
const READ_PATIENCE_MS = 120

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
/** What the card shows, and from where. It moves only once the next one can be shown. */
const drawn = shallowRef<{ element: HTMLElement; preview: ReferencePreview } | null>(null)
const Drawn = () => drawn.value?.preview.render()
const description = computed(() => drawn.value?.preview.describe())

/** The reference the root is pointed at. */
let anchor: HTMLElement | null = null
/** The reference the pointer is on: it opens once, until the pointer has left it. */
let hovered: HTMLElement | null = null
/** A Tab is being pressed, so the focus it moves is the reader's own choice. */
let tabbing = false
/** That focus is what holds the card up, not the pointer. */
let heldByFocus = false
/** A scroll event is on its way through the window: what is asked now is asked because of it. */
let scrolling = false
let reading: AbortController | null = null
/** The card is being held back for a read. */
let waiting = false
/** A press that began on the card's text is still down: it may be a selection being made. */
let pressing = false
/** The card holds a selection the reader made. */
let pinned = false
/** Where focus stood before a press on the card's text took it away. */
let focusBefore: HTMLElement | null = null
/** A pointer move on the card is on its way through the page. */
let movingOnCard = false

const cardElement = () => document.querySelector<HTMLElement>('.reference-preview')
const inCard = (target: EventTarget | null) =>
  target instanceof Node && cardElement()?.contains(target) === true
const onControl = (target: EventTarget | null) =>
  target instanceof Element && target.closest('button') !== null

function selectionInCard() {
  const selection = document.getSelection()
  return Boolean(selection && !selection.isCollapsed && inCard(selection.anchorNode))
}

function giveFocusBack() {
  const back = focusBefore
  focusBefore = null
  if (back?.isConnected) back.focus({ preventScroll: true })
}

/** Close what the reader's own act closes, whatever held the card up. */
function dismiss() {
  pinned = false
  pressing = false
  root?.onClose()
}

function stopReading() {
  reading?.abort()
  reading = null
  waiting = false
}

function pointAt(element: HTMLElement) {
  if (anchor === element) return
  anchor = element
  heldByFocus = false
  root?.onTriggerChange(element)
}

function show(element: HTMLElement, preview: ReferencePreview) {
  stopReading()
  const controller = preview.prepare ? new AbortController() : null
  reading = controller
  const reveal = () => {
    if (reading !== controller) return
    waiting = false
    drawn.value = { element, preview }
    open.value = true
  }
  if (!controller) {
    reveal()
    return
  }
  waiting = true
  const patience = new Promise((resolve) => setTimeout(resolve, READ_PATIENCE_MS))
  void Promise.race([preview.prepare?.(controller.signal), patience]).then(reveal)
}

/** What the root asks for. Closing always goes through; opening needs a reader behind it. */
function request(next: boolean) {
  if (!next) {
    // A Tab scrolls the reference it lands on into view, and that is no reason to close.
    if (scrolling && heldByFocus) return
    if (movingOnCard || ((pressing || pinned) && !scrolling)) return
    pressing = false
    pinned = false
    giveFocusBack()
    if (inCard(document.activeElement)) anchor?.focus({ preventScroll: true })
    stopReading()
    heldByFocus = false
    open.value = false
    return
  }
  if (!anchor || !(tabbing || anchor.matches(':hover'))) return
  if (open.value && drawn.value?.element === anchor) return
  const preview = previewOf(anchor)
  if (preview) show(anchor, preview)
}

/** From the reference into the card's controls, and out of them from the reference again. */
function tabThroughCard(event: KeyboardEvent) {
  const controls = [...(cardElement()?.querySelectorAll<HTMLElement>('button') ?? [])]
  const at = controls.indexOf(document.activeElement as HTMLElement)
  const step = event.shiftKey ? -1 : 1
  if (at < 0) {
    if (focusBefore) giveFocusBack()
    else if (document.activeElement === anchor && !event.shiftKey && heldByFocus) {
      event.preventDefault()
      controls[0]?.focus()
    }
    return
  }
  const next = controls[at + step]
  if (next) {
    event.preventDefault()
    next.focus()
    return
  }
  // Back on the reference: Shift+Tab stops there, and Tab goes on from it as the browser moves it.
  if (event.shiftKey) event.preventDefault()
  anchor?.focus()
}

/** A press on a control moves no focus and clears no selection. */
function pressInCard(event: MouseEvent) {
  if (onControl(event.target)) event.preventDefault()
}

function leave() {
  hovered = null
  root?.onTriggerLeave()
  if (!waiting) return
  stopReading()
  if (open.value) root?.onClose()
}

// Either side of the library's listener on the card, as for a scroll below.
useEventListener(
  window,
  'pointermove',
  (event: PointerEvent) => {
    movingOnCard = inCard(event.target)
  },
  { capture: true },
)
useEventListener(window, 'pointermove', () => {
  movingOnCard = false
})
useEventListener(
  document,
  'pointermove',
  (event: PointerEvent) => {
    if (event.pointerType === 'touch' || pressing || pinned) return
    const element = previewAnchorOf(event.target)
    if (element === hovered) return
    if (hovered) leave()
    // The library swaps this ref as the card mounts, so it is read through its context.
    if (!element || provider?.isPointerInTransitRef.value) return
    pointAt(element)
    root?.onTriggerEnter()
    hovered = element
  },
  { capture: true },
)
useEventListener(
  document,
  'pointerout',
  (event: PointerEvent) => {
    const element = previewAnchorOf(event.target)
    if (element && element === hovered && previewAnchorOf(event.relatedTarget) !== element) leave()
  },
  { capture: true },
)
useEventListener(
  document,
  'pointerdown',
  (event: PointerEvent) => {
    tabbing = false
    if (inCard(event.target)) {
      if (onControl(event.target)) return
      pressing = true
      const focused = document.activeElement
      if (!focusBefore && focused instanceof HTMLElement && focused !== document.body)
        focusBefore = inCard(focused) ? null : focused
      return
    }
    // Their own press elsewhere takes focus for itself, and any selection with it.
    focusBefore = null
    if (pinned) dismiss()
    if (previewAnchorOf(event.target)) root?.onClose()
  },
  { capture: true },
)
useEventListener(
  window,
  ['pointerup', 'pointercancel'],
  (event: PointerEvent) => {
    if (!pressing) return
    pressing = false
    pinned = selectionInCard()
    if (pinned) return
    giveFocusBack()
    // Nothing selected, and the library heard the pointer leave while the press held the card.
    if (!inCard(document.elementFromPoint(event.clientX, event.clientY))) root?.onClose()
  },
  { capture: true },
)
useEventListener(document, 'selectionchange', () => {
  if (!pinned || pressing || selectionInCard()) return
  pinned = false
  giveFocusBack()
})
useEventListener(
  document,
  'click',
  (event: MouseEvent) => {
    if (previewAnchorOf(event.target)) root?.onClose()
  },
  { capture: true },
)
useEventListener(
  document,
  'keydown',
  (event: KeyboardEvent) => {
    tabbing = event.key === 'Tab'
  },
  { capture: true },
)
useEventListener(
  document,
  'keyup',
  () => {
    tabbing = false
  },
  { capture: true },
)
useEventListener(document, 'focusin', (event: FocusEvent) => {
  const element = previewAnchorOf(event.target)
  if (!element || !tabbing) return
  pointAt(element)
  heldByFocus = true
  root?.onOpen()
})
useEventListener(document, 'focusout', (event: FocusEvent) => {
  const element = previewAnchorOf(event.target)
  if (element && element === anchor && !inCard(event.relatedTarget)) root?.onClose()
  // Focus in the card is held there by the keyboard, and goes with it.
  else if (
    inCard(event.target) &&
    event.relatedTarget !== null &&
    event.relatedTarget !== anchor &&
    !inCard(event.relatedTarget)
  )
    dismiss()
})
// Either side of the library's own listener, which mounts with the card on the window and
// closes it on any scroll: the event goes through the window before it reaches the document.
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
useEventListener(
  () => (open.value ? window : null),
  'keydown',
  (event: KeyboardEvent) => {
    if (event.key === 'Tab') tabThroughCard(event)
    if (event.key !== 'Escape' || event.isComposing) return
    event.preventDefault()
    event.stopPropagation()
    dismiss()
  },
  { capture: true },
)

watch(overlayTop, dismiss)

const stopHearing = onPreviewAnchorGone((element) => {
  if (element === hovered) hovered = null
  if (element !== anchor && element !== drawn.value?.element) return
  if (element === anchor) anchor = null
  dismiss()
})
onBeforeUnmount(() => {
  stopHearing()
  stopReading()
})

/** A reference is described by its card while it shows, through the id the root gives the card's text. */
watch([drawn, open], ([shown, isOpen], [before]) => {
  before?.element.removeAttribute('aria-describedby')
  if (isOpen && shown && root) shown.element.setAttribute('aria-describedby', root.contentId)
})
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
        :reference="drawn?.element"
        as-child
      >
        <span hidden />
      </TooltipTrigger>
      <TooltipPortal>
        <TooltipContent
          class="reference-preview"
          side="bottom"
          align="start"
          :side-offset="6"
          :collision-padding="8"
          :aria-label="description"
          hide-when-detached
          @mousedown="pressInCard"
        >
          <Drawn />
        </TooltipContent>
      </TooltipPortal>
    </TooltipRoot>
  </TooltipProvider>
</template>

<!-- The card is portalled out of this component, so its surface is not scoped. -->
<style>
.reference-preview {
  z-index: 120;
  inline-size: min(22rem, var(--reka-tooltip-content-available-width));
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-tooltip-border);
  background: var(--color-tooltip-surface);
  border-radius: var(--radius-control);
  box-shadow: 0 8px 24px var(--color-shadow);

  /* It settles towards the reference it hangs from; passing on from a neighbour
     the card is already there, and does not appear again. */
  &[data-state='delayed-open'] {
    animation: reference-preview-appear var(--duration-quick) var(--ease-out);
  }

  &[data-side='top'] {
    --reference-preview-from: 2px;
  }
}

@keyframes reference-preview-appear {
  from {
    opacity: 0;
    translate: 0 var(--reference-preview-from, -2px);
  }
}

@media (prefers-reduced-motion: reduce) {
  .reference-preview[data-state='delayed-open'] {
    animation: none;
  }
}
</style>
