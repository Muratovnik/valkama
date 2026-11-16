<script setup lang="ts">
/**
 * The whole of a cut text, laid over it: the surface of the `clipped` hints of `v-tooltip`
 * (`tooltipAnchors.ts`), drawn by the window's one tooltip host beside its own hint. A name the
 * rail cuts reads on where its ellipsis stood, rather than standing again in a hint beside it.
 * When it shows and goes is the hint manager's (`hintManager.ts`), by the rules of every hint.
 *
 * - It shows only while its text is cut, measured as it would show, and goes when a window or a
 *   panel that widens the text leaves it whole; one that narrows it lays it again.
 * - Its first letter stands on the cut text's first letter, in that letter's type and ink, and it
 *   runs on to the right up to 8px short of the window's edge, wrapping by words only where the
 *   whole text does not fit there (`placeWhole`). On one line it covers its own line alone.
 * - It is laid on the ground its text stands on, every see-through ground down to the first
 *   opaque one laid together as the page lays them (`groundOf`), so over its own element it reads
 *   as the element's words running on, and a rim and a shadow mark where it lies over the rest of
 *   the page. Its ink and ground are read back from the page, never chosen here, which is why
 *   `check:ui-system` registers it as copying paint rather than authoring it (`COPIED_PAINT`).
 * - It lets the pointer and a press through to what it covers, so the row under it keeps its
 *   hover, a link under it opens and a button presses; the pointer within it still holds it up
 *   (`HintKind.covers`).
 * - It is drawn, not read: assistive technology reads the element's own words, which are whole
 *   in the page however the screen cuts them.
 */
import { computed, nextTick, shallowRef, watch } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

import { closeHint, shownHint, useHintKind } from '@/shared/ui/hintManager.ts'
import { placeWhole } from '@/shared/ui/hintPlacement.ts'
import type { WholePlace } from '@/shared/ui/hintPlacement.ts'
import { previewAnchorOf } from '@/shared/ui/referencePreviewAnchors.ts'
import {
  firstLetterOf,
  focusAnchorOf,
  inTooltipArea,
  pointerAnchorOf,
  showsWhole,
  textIsClipped,
  tooltipOf,
} from '@/shared/ui/tooltipAnchors.ts'

/** What the whole text takes from the letter it starts on, so it is drawn in the same type. */
const TYPE = [
  'font-family',
  'font-feature-settings',
  'font-kerning',
  'font-size',
  'font-stretch',
  'font-style',
  'font-variant-caps',
  'font-variant-ligatures',
  'font-variant-numeric',
  'font-variation-settings',
  'font-weight',
  'letter-spacing',
  'line-height',
  'text-transform',
  'word-spacing',
] as const

const surface = shallowRef<HTMLElement | null>(null)

/** The element whose words an event's target asks for whole, if its hint is of its words. */
const wholeOf = (anchor: HTMLElement | null) => (anchor && showsWhole(anchor) ? anchor : null)

useHintKind('whole', {
  pointedAnchor: (target) => (previewAnchorOf(target) ? null : wholeOf(pointerAnchorOf(target))),
  focusedAnchor: (target) => (previewAnchorOf(target) ? null : wholeOf(focusAnchorOf(target))),
  shows: (anchor) => textIsClipped(anchor) && firstLetterOf(anchor) !== null,
  isArea: inTooltipArea,
  covers(x, y) {
    const box = surface.value?.getBoundingClientRect()
    return box !== undefined && x >= box.left && x < box.right && y >= box.top && y < box.bottom
  },
})

/** The element whose words show whole, while the manager shows them. */
const anchor = computed(() => (shownHint.value?.kind === 'whole' ? shownHint.value.anchor : null))
const text = computed(() => (anchor.value ? (tooltipOf(anchor.value)?.text ?? '') : ''))

/** The type, the ground and the scale the whole text is drawn in, read as it is laid. */
const look = shallowRef<{
  ground: string
  ink: string
  scale: number
  type: Record<string, string>
}>()
const place = shallowRef<WholePlace | null>(null)

const boxStyle = computed(() => {
  const [at, seen] = [place.value, look.value]
  return at && seen
    ? {
        ...seen.type,
        color: seen.ink,
        backgroundColor: seen.ground,
        left: `${at.left}px`,
        top: `${at.top}px`,
        maxInlineSize: `${at.widest}px`,
        transform: seen.scale === 1 ? 'none' : `scale(${seen.scale})`,
      }
    : null
})

/** One pixel the grounds are laid on, which takes any colour the page computes, in any syntax. */
let pixel: CanvasRenderingContext2D | null | undefined

/** `colors` laid one over the next, the first lowest, as the pixel the page would paint. */
function laid(colors: readonly string[]): { alpha: number; color: string } | null {
  pixel ??= document.createElement('canvas').getContext('2d', { willReadFrequently: true })
  if (!pixel) return null
  pixel.clearRect(0, 0, 1, 1)
  for (const color of colors) {
    pixel.fillStyle = color
    pixel.fillRect(0, 0, 1, 1)
  }
  const [red = 0, green = 0, blue = 0, alpha = 0] = pixel.getImageData(0, 0, 1, 1).data
  return { alpha, color: `rgb(${red} ${green} ${blue})` }
}

/**
 * The ground `element` stands on, as one colour: its own and each one under it, up to the first
 * that hides what is under it, laid together; over the canvas where none does.
 */
function groundOf(element: Element): string {
  const grounds: string[] = []
  for (let box: Element | null = element; box; box = box.parentElement) {
    const color = getComputedStyle(box).backgroundColor
    grounds.unshift(color)
    if (laid([color])?.alpha === 255) return laid(grounds)?.color ?? color
  }
  const canvas = getComputedStyle(document.documentElement).getPropertyValue('--color-canvas')
  return laid([canvas, ...grounds])?.color ?? canvas
}

/**
 * Lays the whole text over `element`'s cut one: first where its own first letter would stand
 * with no inset, then, once drawn, moved by where its letter came out inside its box. Both
 * happen before the frame is painted.
 */
async function lay(element: HTMLElement) {
  const letter = firstLetterOf(element)
  if (!letter) {
    closeHint()
    return
  }
  const style = getComputedStyle(letter.inked)
  const drawn = element.getBoundingClientRect().width
  const scale = element.offsetWidth > 0 ? drawn / element.offsetWidth : 1
  look.value = {
    ground: groundOf(letter.inked),
    ink: style.color,
    scale: Math.abs(scale - 1) < 0.01 ? 1 : scale,
    type: Object.fromEntries(TYPE.map((name) => [name, style.getPropertyValue(name)])),
  }
  const setting = {
    letter: letter.box,
    scale: look.value.scale,
    window: document.documentElement.clientWidth,
  }
  place.value = placeWhole({ ...setting, inset: { left: 0, top: 0 } })
  await nextTick()
  const box = surface.value?.getBoundingClientRect()
  const own = surface.value ? firstLetterOf(surface.value) : null
  if (!box || !own || anchor.value !== element) return
  place.value = placeWhole({
    ...setting,
    inset: { left: own.box.left - box.left, top: own.box.top - box.top },
  })
}

watch(anchor, (element) => {
  place.value = null
  if (element) void lay(element)
})

/** A width change lays the shown text again while it is still cut, and closes it once whole. */
function relay() {
  const element = anchor.value
  if (!element) return
  if (textIsClipped(element)) void lay(element)
  else closeHint()
}

useResizeObserver(anchor, relay)
useEventListener(window, 'resize', relay, { passive: true })
</script>

<template>
  <Teleport to="body">
    <div
      v-if="anchor && text"
      ref="surface"
      class="whole-text"
      aria-hidden="true"
      :style="boxStyle"
      data-hint-surface
    >
      {{ text }}
    </div>
  </Teleport>
</template>

<style scoped>
/* Laid in the window over the cut text: as wide as its words up to the room the place leaves,
   then wrapped by words. A word longer than that room breaks rather than run out of the window.
   Its box is its line high, with a pixel over and under for the rim, so it covers no other line.
   It stands over the menus and sheets (120) whose rows it speaks for: level with them, the menu
   opened after it was drawn over it, and a cut state in the card's state menu never read whole. */
.whole-text {
  position: fixed;
  z-index: 130;
  inline-size: max-content;
  padding: var(--space-hair) var(--space-1);
  overflow-wrap: break-word;
  white-space: normal;
  border-radius: var(--radius-status);
  box-shadow:
    inset 0 0 0 1px var(--color-tooltip-border),
    0 4px 12px var(--color-shadow);
  transform-origin: 0 0;
  pointer-events: none;
}
</style>
