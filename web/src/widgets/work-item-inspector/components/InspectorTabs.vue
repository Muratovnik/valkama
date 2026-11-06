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
 * A strip cut by its width fades out at each end that has more past it. The bar alone did
 * not say so: an overlay scrollbar shows only while the strip moves, and a phone's row
 * ended at a cut word with nothing after it. Whatever the browser brings into the row
 * stands clear of the fade, as far in as the fade is wide.
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

/** Whether tabs lie past either end of the row, read off the strip as it stands. */
const more = reactive({ before: false, after: false })
function measure() {
  const node = strip.value
  if (!node) return
  // A pixel of room: a zoomed page scrolls by fractions and never quite reaches its end.
  more.before = node.scrollLeft > 1
  more.after = node.scrollWidth - node.clientWidth - node.scrollLeft > 1
}
// The strip changes width with the card, and its row with the sections it holds.
useResizeObserver(
  computed(() => [strip.value, strip.value?.firstElementChild as HTMLElement | null]),
  measure,
)

/** Into the row: the strip is the only thing that scrolls for it. */
function reveal(target: Element | null | undefined) {
  target?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    container: 'nearest',
  } as ScrollIntoViewOptions)
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
  if (event.target instanceof Element) reveal(event.target)
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
  scroll-padding-inline: var(--size-tabs-fade);

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
