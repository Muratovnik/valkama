<script setup lang="ts">
/**
 * The whole of a cut text, laid over it: the surface of the `clipped` hints of `v-tooltip`
 * (`tooltipAnchors.ts`), drawn by the window's one tooltip host beside its own hint. A name the
 * rail cuts reads on where its ellipsis stood, rather than standing again in a hint beside it.
 * When it shows and goes is the hint manager's (`hintManager.ts`), by the rules of every hint.
 *
 * - It shows only while its text is cut, measured as it would show, and goes when a window or a
 *   panel that widens the text leaves it whole; one that narrows it lays it again. A transform
 *   that moves or scales the text, as the graph's camera does, lays it again on the text, or takes
 *   it down where the text no longer stands in sight.
 * - Its first letter stands on the cut text's first letter, in the type and ink of the line that
 *   letter stands in, never of a run such as code or a link the text starts with (`lineOf`), and it
 *   runs on to the right up to 8px short of the window's edge, wrapping by words only where the
 *   whole text does not fit there (`placeWhole`). On one line it covers its own line alone. Over
 *   a text a clamp cuts to its lines it takes the clamp's whole column and the clamp's alignment
 *   and grows down past it, so it reads as the clamp opened in place: its words wrap where the
 *   clamp's did, so its first line is the clamp's and its first letter the cut one, it breaks a
 *   word only where the clamp does, and it lies over every line the clamp shows and its ellipsis,
 *   with no empty room under its last line. Run on to the window's edge, a board tile's title cut
 *   at its third line lay on one line across the next columns over 38px of empty frame; laid from
 *   the first letter, the whole words over a table's column heading, whose lines end at the
 *   column's end, stood inside the column, narrower than it, broke words in two and left the
 *   clamp's second line showing beside them. Where the window has no room under it for all its
 *   lines, it stands higher, 8px short of the window's bottom edge.
 * - It is laid on the ground its line stands on, every see-through ground down to the first
 *   opaque one laid together as the page lays them (`groundOf`), so over its own element it reads
 *   as the element's words running on, and a rim and a shadow mark where it lies over the rest of
 *   the page. Its ink and ground are read back from the page, never chosen here, which is why
 *   `check:ui-system` registers it as copying paint rather than authoring it (`COPIED_PAINT`).
 * - Where its element takes the pointer past its words, as a tile's open target does over the
 *   whole tile, the pointer raises it only over the part its words stand in (`onTooltipWords`).
 * - It lets the pointer and a press through to what it covers, so the row under it keeps its
 *   hover, a link under it opens and a button presses; the pointer within it still holds it up
 *   (`HintKind.covers`).
 * - It fades in where it lies after the pointer's rest, and is there at once passing on from a
 *   neighbour, as every hint is.
 * - A text drawn in runs (`textRuns.ts`), as a work item's title is, is laid in the same runs, so
 *   its code reads as code over the cut code rather than as the backticks it was written in, and
 *   the rest in the line's type.
 * - It is drawn, not read: assistive technology reads the element's own words, which are whole
 *   in the page however the screen cuts them.
 */
import { computed, nextTick, shallowRef, watch } from 'vue'
import type { CSSProperties } from 'vue'

import { useEventListener, useRafFn, useResizeObserver } from '@vueuse/core'

import { closeHint, shownHint, useHintKind } from '@/shared/ui/hintManager.ts'
import { placeWhole } from '@/shared/ui/hintPlacement.ts'
import type { WholePlace } from '@/shared/ui/hintPlacement.ts'
import { previewAnchorOf } from '@/shared/ui/referencePreviewAnchors.ts'
import { runsDrawnIn, vTextRuns } from '@/shared/ui/textRuns.ts'
import {
  cutLinesOf,
  firstLetterOf,
  focusAnchorOf,
  inTooltipArea,
  onTooltipWords,
  pointerAnchorOf,
  showsWhole,
  textIsClipped,
  tooltipOf,
} from '@/shared/ui/tooltipAnchors.ts'

/** What the whole text takes from the line it starts on, so it is drawn in the same type. */
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
  pointedAnchor: (target, at) =>
    previewAnchorOf(target) ? null : wholeOf(pointerAnchorOf(target, at)),
  focusedAnchor: (target) => (previewAnchorOf(target) ? null : wholeOf(focusAnchorOf(target))),
  shows: (anchor) => textIsClipped(anchor) && firstLetterOf(anchor) !== null,
  isArea: inTooltipArea,
  reaches: onTooltipWords,
  covers(x, y) {
    const box = surface.value?.getBoundingClientRect()
    return box !== undefined && x >= box.left && x < box.right && y >= box.top && y < box.bottom
  },
})

/** The element whose words show whole, while the manager shows them. */
const anchor = computed(() => (shownHint.value?.kind === 'whole' ? shownHint.value.anchor : null))
const text = computed(() => (anchor.value ? (tooltipOf(anchor.value)?.text ?? '') : ''))
/** The runs the cut text is drawn in, when it is (`textRuns.ts`): its code is code here too. */
const runs = computed(() =>
  anchor.value && text.value ? runsDrawnIn(anchor.value, text.value) : null,
)
/** How the whole text opened: after the pointer's rest, when it fades in, or at once. */
const opened = computed(() =>
  shownHint.value?.kind === 'whole' && shownHint.value.rested ? 'after-rest' : 'at-once',
)

/** The type, the ground and the scale the whole text is drawn in, read as it is laid. */
const look = shallowRef<{
  /** How the cut text's lines are aligned: a clamp's whole words take it, wrapping as it did. */
  align: CSSProperties['textAlign']
  ground: string
  ink: string
  scale: number
  type: Record<string, string>
}>()
const place = shallowRef<WholePlace | null>(null)
/** The cut text's first letter as it stood when the whole text was last laid from it. */
let laidFrom: DOMRect | null = null

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
        minInlineSize: at.least ? `${at.least.inline}px` : undefined,
        minBlockSize: at.least ? `${at.least.block}px` : undefined,
        textAlign: at.least ? seen.align : undefined,
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
 * The elements that set a run of a line's words apart in a look of their own: code, emphasis,
 * strong words, a deletion and a link, as the runs of a title (`textRuns.ts`) and the inline half
 * of a rich text (`RichInlines`) draw them.
 */
const RUNS = new Set(['A', 'CODE', 'DEL', 'EM', 'STRONG'])

/**
 * The element whose type, ink and ground are those of the line that `inked` draws a letter of
 * inside `element`: `inked`, or, where that letter stands in a run laid in the line (`RUNS`), the
 * element the outermost such run stands in. A box laid out on its own, as an inline block is,
 * draws a line of its own, and nothing past it is looked at. Read from the run, the whole words of
 * a title that starts with code were all set in code's type, and those of a preview that starts
 * with a link all in the link's ink.
 */
function lineOf(inked: Element, element: HTMLElement): Element {
  let line = inked
  for (let box: Element | null = inked; box && box !== element; box = box.parentElement) {
    if (getComputedStyle(box).display !== 'inline') break
    if (RUNS.has(box.tagName)) line = box.parentElement ?? line
  }
  return line
}

/** How far in from its left edge `box`'s lines start, in px of its own type: its padding. */
function padOf(box: HTMLElement): number {
  const style = getComputedStyle(box)
  return (
    (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.borderLeftWidth) || 0)
  )
}

/**
 * Lays the whole text over `element`'s cut one: first where its own first letter would stand
 * with no inset, then, once drawn, moved by where its letter came out inside its box, or over a
 * clamp by how far in its lines start, and, drawn that wide, raised where it is taller than the
 * window leaves under it. All of it happens before the frame is painted.
 */
async function lay(element: HTMLElement) {
  const letter = firstLetterOf(element)
  if (!letter) {
    closeHint()
    return
  }
  laidFrom = letter.box
  const line = lineOf(letter.inked, element)
  const style = getComputedStyle(line)
  const drawn = element.getBoundingClientRect().width
  const scale = element.offsetWidth > 0 ? drawn / element.offsetWidth : 1
  look.value = {
    // The page computes one of the keywords the property takes.
    align: style.textAlign as CSSProperties['textAlign'],
    ground: groundOf(line),
    ink: style.color,
    scale: Math.abs(scale - 1) < 0.01 ? 1 : scale,
    type: Object.fromEntries(TYPE.map((name) => [name, style.getPropertyValue(name)])),
  }
  const setting = {
    letter: letter.box,
    lines: cutLinesOf(element),
    scale: look.value.scale,
    window: document.documentElement.clientWidth,
  }
  place.value = placeWhole({ ...setting, inset: { left: 0, top: 0 } })
  await nextTick()
  const drawnBox = surface.value
  const box = drawnBox?.getBoundingClientRect()
  const own = drawnBox ? firstLetterOf(drawnBox) : null
  if (!drawnBox || !box || !own || anchor.value !== element) return
  const laid = {
    ...setting,
    inset: { left: own.box.left - box.left, top: own.box.top - box.top },
    pad: padOf(drawnBox) * setting.scale,
  }
  place.value = placeWhole(laid)
  await nextTick()
  const laidBox = surface.value?.getBoundingClientRect()
  if (!laidBox || anchor.value !== element) return
  const tall = { drawn: laidBox.height, window: document.documentElement.clientHeight }
  place.value = placeWhole({ ...laid, tall })
}

/** Further than this, in px, the cut text's first letter has moved or changed its size. */
const MOVED = 0.25

/**
 * A transform moves and scales the cut text with no resize and no scroll, as the graph's camera
 * does under the wheel, a pinch or a key it follows, and no event says so: while the whole text is
 * laid, its first letter is read each frame. Moved or scaled, the whole text is laid on it again
 * where the letter is still what the window shows there, and goes where it is not: carried out of
 * its view or under something else. Laid once, it stayed at the place and scale it opened at.
 */
function follow() {
  const element = anchor.value
  const before = laidFrom
  if (!element || !before) return
  const letter = firstLetterOf(element)?.box
  if (!letter) {
    closeHint()
    return
  }
  const moved = [
    letter.left - before.left,
    letter.top - before.top,
    letter.height - before.height,
  ].some((change) => Math.abs(change) > MOVED)
  if (!moved) return
  const there = document.elementFromPoint(
    letter.left + letter.width / 2,
    letter.top + letter.height / 2,
  )
  if (there && element.contains(there)) void lay(element)
  else closeHint()
}

const following = useRafFn(follow, { immediate: false })

watch(anchor, (element) => {
  place.value = null
  laidFrom = null
  if (!element) {
    following.pause()
    return
  }
  void lay(element)
  following.resume()
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
      :data-opened="opened"
      data-hint-surface
    >
      <span
        v-if="runs"
        v-text-runs="runs"
      /><template v-else>{{ text }}</template>
    </div>
  </Teleport>
</template>

<style scoped>
/* Laid in the window over the cut text: as wide as its words up to the room the place leaves,
   then wrapped by words. A word longer than that room breaks rather than run out of the window.
   Its box is its line high, with a pixel over and under for the rim, so it covers no other line;
   over a clamp of several lines, its lines as wide as the clamp's column and aligned as the
   clamp's, as high as its words take there, never lower than the lines the clamp shows
   (`placeWhole`).
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

  /* It fades in where it lies after the rest, never moving: its letters stand on the cut ones.
     Passing on from a neighbour, or brought by a key, it is already there. */
  &[data-opened='after-rest'] {
    animation: whole-text-appear var(--duration-quick) var(--ease-out);
  }
}

@keyframes whole-text-appear {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .whole-text[data-opened='after-rest'] {
    animation: none;
  }
}
</style>
