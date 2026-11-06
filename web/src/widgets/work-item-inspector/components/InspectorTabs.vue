<script setup lang="ts">
/**
 * The card's sections, as the strip that sticks to the top of its scroller.
 *
 * It stays pinned at every position, so it holds to one row: two rows of sections were
 * a third of what a phone kept pinned. Where one row cannot hold them it scrolls inside
 * itself, over the thin bar every scroller here has, because a cut that fell between
 * two sections read as the whole strip. The one shown is brought into the row whenever
 * it changes, and so is each one the keyboard reaches, which the browser leaves where
 * it is while a sliver of it shows.
 *
 * They are tabs over the card's body, and every section shows the moment it is chosen —
 * what one reads is read with the card — so the arrows show a section as they reach it.
 *
 * A strip cut by its width fades out at each end where a section is cut, and at no other.
 * The bar alone did not say so: an overlay scrollbar shows only while the strip moves, and
 * a phone's row ended at a cut word with nothing after it. The fade is keyed to that cut,
 * never to how far the strip has scrolled: a strip moved two pixels had faded the start
 * over a whole first section, since the row's own inset hides nothing.
 *
 * A section already in sight and clear of the fade stays where it is when it is picked;
 * one that is not is brought in as far as the fade is wide, so its words stand clear of it.
 * A browser asked to keep a fade's width clear of every pick moved the strip by the two
 * pixels a section already in sight stood inside that width.
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'

import { useResizeObserver } from '@vueuse/core'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import type { TabIds } from '@/shared/ui/tabIds.ts'

const props = defineProps<{
  label: string
  sections: readonly ChoiceOption[]
  /** The ids its sections share with the panel that shows the chosen one. */
  tabs: TabIds
}>()
const shown = defineModel<string>({ required: true })
const strip = ref<HTMLElement | null>(null)

/** A zoomed page scrolls by fractions and never quite reaches its end: a pixel is no cut. */
const SLACK = 1

const sectionsIn = (node: HTMLElement) => [...node.querySelectorAll('button')]

/** Whether a section is cut at either end of the row, read off the strip as it stands. */
const more = reactive({ before: false, after: false })
function measure() {
  const node = strip.value
  if (!node) return
  const row = node.getBoundingClientRect()
  const sections = sectionsIn(node)
  const first = sections[0]?.getBoundingClientRect()
  const last = sections.at(-1)?.getBoundingClientRect()
  more.before = first !== undefined && row.left - first.left > SLACK
  more.after = last !== undefined && last.right - row.right > SLACK
}
// The strip changes width with the card, and its row with the sections it holds: the one
// shown widens as it takes the heavier weight, after the pick that brought it in.
useResizeObserver(
  computed(() => [strip.value, strip.value?.firstElementChild as HTMLElement | null]),
  () => {
    measure()
    revealShown()
  },
)

/** Where a section's words are drawn: the section's own box holds its padding too. */
function wordsOf(section: HTMLElement): DOMRect {
  const range = document.createRange()
  range.selectNodeContents(section)
  return range.getBoundingClientRect()
}

/**
 * Into the row, and only when it is not in sight already: the strip is the only thing that
 * scrolls for it. The first and the last section go to the row's ends, which no fade covers.
 */
function reveal(target: Element | null | undefined) {
  const node = strip.value
  if (!node || !(target instanceof HTMLElement)) return
  measure()
  const fade = Number.parseFloat(getComputedStyle(node).getPropertyValue('--size-tabs-fade'))
  const row = node.getBoundingClientRect()
  const words = wordsOf(target)
  const start = row.left + (more.before ? fade : 0)
  const end = row.right - (more.after ? fade : 0)
  if (words.left >= start - SLACK && words.right <= end + SLACK) return
  const sections = sectionsIn(node)
  const box = target.getBoundingClientRect()
  if (words.left < start) {
    node.scrollLeft = target === sections[0] ? 0 : node.scrollLeft + box.left - row.left - fade
  } else {
    node.scrollLeft =
      target === sections.at(-1) ? node.scrollWidth : node.scrollLeft + box.right - row.right + fade
  }
}

function revealShown() {
  const index = props.sections.findIndex((section) => section.value === shown.value)
  reveal(strip.value?.querySelectorAll('button')[index])
}

onMounted(revealShown)
// Once the whole flush is over, and not in its post queue. Overview is `v-show`, which
// shows it from that same queue and behind this watcher, so a section leaving had left
// nothing to measure: asking for layout there collapsed the scroller to an empty body,
// the browser clamped it to 0, and the strip left from under the pointer that pressed it.
watch(shown, () => nextTick(revealShown))

function focused(event: FocusEvent) {
  reveal(event.target as Element | null)
}
</script>

<template>
  <div
    ref="strip"
    class="inspector-tabs"
    :class="{ 'more-before': more.before, 'more-after': more.after }"
    @focusin="focused"
    @scroll="measure"
  >
    <SegmentedControl
      v-model="shown"
      size="compact"
      :label="label"
      :options="sections"
      :tabs="tabs"
    />
  </div>
</template>

<style scoped>
.inspector-tabs {
  --size-tabs-fade: var(--space-8);

  width: 100%;
  overflow-x: auto;

  /* A mask reads only how opaque its image is, so the colour stands for "shown". */
  &.more-before {
    mask-image: linear-gradient(to right, transparent, black var(--size-tabs-fade));
  }

  &.more-after {
    mask-image: linear-gradient(to left, transparent, black var(--size-tabs-fade));
  }

  &.more-before.more-after {
    mask-image: linear-gradient(
      to right,
      transparent,
      black var(--size-tabs-fade),
      black calc(100% - var(--size-tabs-fade)),
      transparent
    );
  }
}
</style>
