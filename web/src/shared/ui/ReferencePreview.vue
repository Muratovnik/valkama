<script setup lang="ts">
/**
 * The one preview of the window: the card a reference in text shows, drawn against whichever
 * reference the hint manager (`hintManager.ts`) shows it for. When the card shows and when it goes
 * are the manager's, as for every hint: after half a second's rest of the pointer, at once while a
 * hint or a card is up or has just gone, at once on focus a key brought, never for a finger; it
 * goes with a press elsewhere, Escape, a scroll and the pointer leaving both the reference and the
 * card, and it replaces a hint, and a hint it, as one surface of the window. What the card shows,
 * and what a reader can do on it, is decided here.
 *
 * The surface is the library's hover-card content on a root whose `open` is held, placed through
 * its documented `reference` prop, as the hint's is (`TooltipHost`). Nothing here reaches into the
 * library's internal context. Its content takes the card's controls out of the page's tab order as
 * it mounts, and the Tab below reaches them on its own, so that changes nothing.
 *
 * What the manager does not decide is decided here:
 * - A press inside the card leaves focus where it was: focus leaving an overlay's surface would let
 *   the next Tab out from behind its backdrop. A browser moves focus as a press starts a selection,
 *   and refusing the press refused the selection too, so a press on text goes through and focus
 *   goes back: when the press ends with nothing selected, otherwise at the next Tab or as the card
 *   closes, since a text field taking focus would clear what the reader just selected. A press on
 *   a control is refused, so no focus moves at all, and so is a press on the card's ground, on no
 *   line of its text: the browser starts a selection there from the nearest letter, so a drag from
 *   the card's edge that selected nothing the reader aimed at held the card up after it.
 * - A selection holds the card up. While the press that makes it is down the card does not close,
 *   wherever the pointer goes, and once made it stays until the reader's own press elsewhere,
 *   Escape or a scroll: a card closing under a pointer on its way to nothing would take the
 *   selection with it. A press that selected nothing and ended off the card closes it.
 * - Tab goes from the reference through the card's controls and on from the reference, since the
 *   card is portalled away from it and the document's own order would never reach them. Focus in
 *   the card keeps it, and focus the card had when it closes goes back to its reference.
 * - The reference is described by the card's words while the card shows. They are kept apart
 *   from the card, out of sight and out of reading order, so the card holds its words once and
 *   a reader going through it does not meet them again after its controls.
 *
 * A preview that has to read waits for its answer a moment before it shows, so a quick answer is
 * never preceded by a line saying it is on its way; one that answers after the pointer left its
 * reference shows only if the pointer comes back before the card goes.
 */
import { computed, onBeforeUnmount, shallowRef, useId, watch } from 'vue'

import { useEventListener } from '@vueuse/core'
import { HoverCardContent, HoverCardPortal, HoverCardRoot } from 'reka-ui'

import type { ReferencePreview } from '@/shared/lib/referenceLinks.ts'
import { placeFocus } from '@/shared/lib/scriptedFocus.ts'
import {
  closeHint,
  hintAnchorGone,
  pointedPart,
  shownHint,
  useHintKind,
} from '@/shared/ui/hintManager.ts'
import {
  onPreviewAnchorGone,
  previewAnchorOf,
  previewOf,
} from '@/shared/ui/referencePreviewAnchors.ts'

/** How long a preview that reads may hold the card back before it shows what it has. */
const READ_PATIENCE_MS = 120
/** The room between the card and its reference, and between the card and the window's edge, in px. */
const OFFSET = 6
const EDGE = 8

/**
 * A press that began on the card, off its controls, is still down: on its text it may be a
 * selection being made, and wherever it began the card stays until it ends.
 */
let pressing = false
/** The card holds a selection the reader made. */
let pinned = false
/** Focus is being handed back to the reference as the card closes: the page's move, not a choice. */
let returning = false

useHintKind('reference', {
  pointedAnchor: previewAnchorOf,
  focusedAnchor: previewAnchorOf,
  shows: (anchor) => !returning && previewOf(anchor) !== undefined,
  isArea: () => false,
  interactive: true,
  holds: () => pressing || pinned,
})

/** This kind's card, while the manager shows one. */
const mine = computed(() => (shownHint.value?.kind === 'reference' ? shownHint.value : null))
/** What the card shows, and from where. It moves only once the next one can be shown. */
const drawn = shallowRef<{ element: HTMLElement; preview: ReferencePreview } | null>(null)
const Drawn = () => drawn.value?.preview.render()
const description = computed(() => drawn.value?.preview.describe())
const open = computed(() => mine.value !== null && drawn.value !== null)
/** How the card opened: after the pointer's rest, when it settles in, or at once. */
const opened = computed(() => (mine.value?.rested ? 'after-rest' : 'at-once'))
/** The card's words in one line, which describe its reference while it shows. */
const copyId = useId()

let reading: AbortController | null = null
/** A read answered while the pointer was off its reference: it shows if the pointer comes back. */
let answered: (() => void) | null = null
/** Where focus stood before a press on the card's text took it away. */
let focusBefore: HTMLElement | null = null

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

function stopReading() {
  reading?.abort()
  reading = null
  answered = null
}

/** The pointer raised the card and is on neither its reference nor the card. */
const pointerAway = (element: HTMLElement) => {
  const part = pointedPart.value
  return mine.value?.by === 'pointer' && !(part && (element.contains(part) || inCard(part)))
}

function show(element: HTMLElement, preview: ReferencePreview) {
  stopReading()
  const controller = preview.prepare ? new AbortController() : null
  reading = controller
  const reveal = () => {
    if (reading !== controller || mine.value?.anchor !== element) return
    if (pointerAway(element)) {
      answered = reveal
      return
    }
    answered = null
    drawn.value = { element, preview }
  }
  if (!controller) {
    reveal()
    return
  }
  const patience = new Promise((resolve) => setTimeout(resolve, READ_PATIENCE_MS))
  void Promise.race([preview.prepare?.(controller.signal), patience]).then(reveal)
}

/** The card closed: what held it up goes, and focus it had goes back to its reference. */
function closed(anchor: HTMLElement | undefined) {
  pressing = false
  pinned = false
  giveFocusBack()
  if (anchor?.isConnected && inCard(document.activeElement)) {
    returning = true
    anchor.focus({ preventScroll: true })
    returning = false
  }
  stopReading()
  drawn.value = null
}

watch(mine, (now, before) => {
  if (!now) {
    closed(before?.anchor)
    return
  }
  if (now.anchor === before?.anchor && drawn.value?.element === now.anchor) return
  const preview = previewOf(now.anchor)
  if (preview) show(now.anchor, preview)
})
watch(pointedPart, () => {
  const element = mine.value?.anchor
  if (answered && element && !pointerAway(element)) answered()
})

/** From the reference into the card's controls, and out of them from the reference again. */
function tabThroughCard(event: KeyboardEvent) {
  const anchor = mine.value?.anchor
  const controls = [...(cardElement()?.querySelectorAll<HTMLElement>('button') ?? [])]
  const at = controls.indexOf(document.activeElement as HTMLElement)
  const step = event.shiftKey ? -1 : 1
  if (at < 0) {
    if (focusBefore) giveFocusBack()
    else if (document.activeElement === anchor && !event.shiftKey && mine.value?.by === 'focus') {
      event.preventDefault()
      placeFocus(controls[0])
    }
    return
  }
  const next = controls[at + step]
  if (next) {
    event.preventDefault()
    placeFocus(next)
    return
  }
  // Back on the reference: Shift+Tab stops there, and Tab goes on from it as the browser moves it.
  if (event.shiftKey) event.preventDefault()
  placeFocus(anchor)
}

/** Whether the point stands on a line of the card's text, where a press starts a selection. */
function onText(x: number, y: number) {
  const node = document.caretPositionFromPoint(x, y)?.offsetNode
  if (!(node instanceof Text)) return false
  const range = document.createRange()
  range.selectNodeContents(node)
  return [...range.getClientRects()].some(
    (line) => x >= line.left && x <= line.right && y >= line.top && y <= line.bottom,
  )
}

/** A press on a control or on the card's ground moves no focus and starts no selection. */
function pressInCard(event: MouseEvent) {
  if (onControl(event.target) || !onText(event.clientX, event.clientY)) event.preventDefault()
}

useEventListener(
  document,
  'pointerdown',
  (event: PointerEvent) => {
    if (!inCard(event.target)) {
      // Their own press elsewhere takes focus for itself, and any selection with it.
      focusBefore = null
      pinned = false
      return
    }
    if (onControl(event.target)) return
    pressing = true
    const focused = document.activeElement
    if (!focusBefore && focused instanceof HTMLElement && focused !== document.body)
      focusBefore = inCard(focused) ? null : focused
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
    // Nothing selected, and the press that held the card ended off it.
    if (!inCard(document.elementFromPoint(event.clientX, event.clientY))) closeHint()
  },
  { capture: true },
)
useEventListener(document, 'selectionchange', () => {
  if (!pinned || pressing || selectionInCard()) return
  pinned = false
  giveFocusBack()
})
useEventListener(
  () => (open.value ? window : null),
  'keydown',
  (event: KeyboardEvent) => {
    if (event.key === 'Tab') tabThroughCard(event)
  },
  { capture: true },
)

const stopHearing = onPreviewAnchorGone((element) => {
  hintAnchorGone(element)
  if (drawn.value?.element === element) drawn.value = null
})
onBeforeUnmount(() => {
  stopHearing()
  stopReading()
})

/** A reference is described by its card's text while the card shows. */
watch([drawn, open], ([shown, isOpen], [before]) => {
  before?.element.removeAttribute('aria-describedby')
  if (isOpen && shown) shown.element.setAttribute('aria-describedby', copyId)
})
</script>

<template>
  <HoverCardRoot :open="open">
    <HoverCardPortal>
      <HoverCardContent
        v-if="drawn && mine"
        class="reference-preview"
        side="bottom"
        align="start"
        :data-opened="opened"
        :reference="drawn.element"
        :side-offset="OFFSET"
        :collision-padding="EDGE"
        data-hint-surface
        hide-when-detached
        @mousedown="pressInCard"
      >
        <Drawn />
      </HoverCardContent>
    </HoverCardPortal>
  </HoverCardRoot>
  <!-- The words the reference is described by while its card shows, out of the card's own text. -->
  <div hidden>
    <span
      :id="copyId"
      data-reference-description
      >{{ description }}</span
    >
  </div>
</template>

<!-- The card is portalled out of this component, so its surface is not scoped. -->
<style>
.reference-preview {
  z-index: 120;
  inline-size: min(22rem, var(--reka-hover-card-content-available-width));
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--color-tooltip-border);
  background: var(--color-tooltip-surface);
  border-radius: var(--radius-control);
  box-shadow: 0 8px 24px var(--color-shadow);

  /* It settles towards the reference it hangs from after the rest; passing on from a neighbour,
     or brought by a key, it is already there and does not appear again. */
  &[data-opened='after-rest'] {
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
  .reference-preview[data-opened='after-rest'] {
    animation: none;
  }
}
</style>
