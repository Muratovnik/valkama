<script setup lang="ts">
/**
 * A row of choices that scrolls sideways where its room is narrower than it: a card's sections,
 * the Analytics periods on a phone. It is the box that scrolls, the row in its slot, and its
 * choices are the buttons the row holds; `chosen` is the place of the one chosen among them.
 * Both strips had grown their own: the card's faded its cut ends and kept its section in view, and
 * the periods kept the chosen one in view by the browser's nearest edge and faded nothing, so a
 * phone's row began and ended at a cut word, a letter of the first period at its start, with
 * nothing to say more lay past either end.
 *
 * A strip cut by its width fades out at each end where a choice is cut, and at no other. A
 * scrollbar alone did not say so: an overlay one shows only while the strip moves. The fade is
 * keyed to that cut, never to how far the strip has scrolled: a strip moved two pixels had faded
 * the start over a whole first choice, since the row's own inset hides nothing.
 *
 * The one chosen is brought into the row whenever it changes and whenever the strip or its row
 * changes width, and so is each one the keyboard reaches, which the browser leaves where it is
 * while a sliver of it shows, and the one a press focused once the press is over. One already in
 * sight and clear of the fade stays where it is; one that is not is brought in as far as the fade
 * is wide, so its words stand clear of it, and the first and the last go to the row's ends, which
 * no fade covers. A browser asked to keep a fade's width clear of every pick moved the strip by
 * the two pixels a choice already in sight stood inside that width.
 *
 * A mask on the strip takes its scrollbar too: drawn over the whole strip, the fade ate the thumb
 * wherever it ran under a cut end. So the fade stops over the bar's strip, as tall as the strip
 * draws its bar, read off the strip as it stands: none where the bar lies over the row and draws
 * no room of its own, as a phone's does, or where a host hides it.
 *
 * The strip is `data-choice-strip`, the box that scrolls, its fade the `mask-image` it computes and
 * its width `--size-strip-fade`, which is what a check reads.
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

const props = defineProps<{
  /** The place of the chosen choice among the row's buttons; -1 for none. */
  chosen: number
}>()

const strip = ref<HTMLElement | null>(null)

/** A zoomed page scrolls by fractions and never quite reaches its end: a pixel is no cut. */
const SLACK = 1

const choicesIn = (node: HTMLElement) => [...node.querySelectorAll('button')]

/** Whether a choice is cut at either end of the row, read off the strip as it stands. */
const more = reactive({ before: false, after: false })
/** How tall the strip draws its bar, in pixels: the room it takes under the row. */
const bar = ref(0)
function measure() {
  const node = strip.value
  if (!node) return
  bar.value = node.offsetHeight - node.clientHeight
  const row = node.getBoundingClientRect()
  const choices = choicesIn(node)
  const first = choices[0]?.getBoundingClientRect()
  const last = choices.at(-1)?.getBoundingClientRect()
  more.before = first !== undefined && row.left - first.left > SLACK
  more.after = last !== undefined && last.right - row.right > SLACK
}
// The strip changes width with its host, and its row with the choices it holds: the one chosen
// widens as it takes the heavier weight, after the pick that brought it in.
useResizeObserver(
  computed(() => [strip.value, strip.value?.firstElementChild as HTMLElement | null]),
  () => {
    measure()
    revealChosen()
  },
)

/** Where a choice's words are drawn: the choice's own box holds its padding too. */
function wordsOf(choice: HTMLElement): DOMRect {
  const range = document.createRange()
  range.selectNodeContents(choice)
  return range.getBoundingClientRect()
}

/** Into the row, and only when it is not in sight already: the strip is all that scrolls for it. */
function reveal(target: Element | null | undefined) {
  const node = strip.value
  if (!node || !(target instanceof HTMLElement)) return
  measure()
  const fade = Number.parseFloat(getComputedStyle(node).getPropertyValue('--size-strip-fade'))
  const row = node.getBoundingClientRect()
  const words = wordsOf(target)
  const start = row.left + (more.before ? fade : 0)
  const end = row.right - (more.after ? fade : 0)
  if (words.left >= start - SLACK && words.right <= end + SLACK) return
  const choices = choicesIn(node)
  const box = target.getBoundingClientRect()
  if (words.left < start) {
    node.scrollLeft = target === choices[0] ? 0 : node.scrollLeft + box.left - row.left - fade
  } else {
    node.scrollLeft =
      target === choices.at(-1) ? node.scrollWidth : node.scrollLeft + box.right - row.right + fade
  }
}

function revealChosen() {
  const node = strip.value
  if (node && props.chosen >= 0) reveal(choicesIn(node)[props.chosen])
}

onMounted(revealChosen)
// Once the whole flush is over, and not in its post queue. A card's overview is `v-show`, which
// shows it from that same queue and behind this watcher, so a section leaving had left nothing to
// measure: asking for layout there collapsed the scroller to an empty body, the browser clamped it
// to 0, and the strip left from under the pointer that pressed it.
watch(
  () => props.chosen,
  () => nextTick(revealChosen),
)

/**
 * Focus brought by a press is not brought in as it lands; any other is. A press focuses a choice
 * on its way down and chooses it on its way up, and a strip moved in between left another choice,
 * or none, under the pointer, so the press chose nothing; a finger's tap, whose press the browser
 * sends after the finger lifts, lost its first try the same way.
 *
 * The choice a press focused is brought in once the press is over, wherever it was let go, in the
 * task after the click it makes. Its being chosen could not say so: a press on the one already
 * chosen changes nothing, and one let go off the row chooses nothing, and either left a focused
 * choice under the fade.
 */
let pressing = false
useEventListener(strip, 'mousedown', () => {
  pressing = true
})
useEventListener(
  window,
  'mouseup',
  () => {
    if (pressing) setTimeout(pressed)
  },
  { capture: true },
)

function pressed() {
  pressing = false
  const choice = document.activeElement
  if (strip.value?.contains(choice)) reveal(choice)
}

function focused(event: FocusEvent) {
  if (!pressing) reveal(event.target as Element | null)
}
</script>

<template>
  <div
    ref="strip"
    class="choice-strip"
    :class="{ 'more-before': more.before, 'more-after': more.after }"
    :style="{ '--size-strip-bar': `${bar}px` }"
    data-choice-strip
    @focusin="focused"
    @scroll="measure"
  >
    <slot />
  </div>
</template>

<style scoped>
.choice-strip {
  --size-strip-fade: var(--space-8);
  --size-strip-bar: 0px;
  --strip-fade-start: black;
  --strip-fade-end: black;

  overflow-x: auto;

  &.more-before {
    --strip-fade-start: transparent;
  }

  &.more-after {
    --strip-fade-end: transparent;
  }

  /* A mask reads only how opaque its image is, so the colour stands for "shown". The fade over
     the row, and under it the bar's strip laid whole (`--size-strip-bar`). */
  &:is(.more-before, .more-after) {
    mask-image:
      linear-gradient(
        to right,
        var(--strip-fade-start),
        black var(--size-strip-fade),
        black calc(100% - var(--size-strip-fade)),
        var(--strip-fade-end)
      ),
      linear-gradient(black, black);
    mask-repeat: no-repeat;
    mask-position: top, bottom;
    mask-size:
      100% calc(100% - var(--size-strip-bar)),
      100% var(--size-strip-bar);
  }
}
</style>
