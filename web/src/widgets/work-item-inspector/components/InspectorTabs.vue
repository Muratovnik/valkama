<script setup lang="ts">
/**
 * The card's sections, as the strip at the foot of its head.
 *
 * In a whole head every section is named on the strip at every width: where
 * one row cannot hold them the strip takes a second row, rather than a
 * scrollbar that hid the last section behind its own arrows on a phone. Read
 * down the body, the head pins one row and no more — two rows of sections were
 * a third of what a phone kept pinned — so the strip scrolls inside its row,
 * over a thin scrollbar of its own that says there is more: a cut that fell
 * between two sections read as the whole strip. The one shown is brought into
 * the row when the head condenses and whenever it changes, and so is each one
 * the keyboard reaches, which the browser leaves where it is while a sliver of
 * it shows.
 */
import { nextTick, ref, watch } from 'vue'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

const props = defineProps<{
  condensed: boolean
  label: string
  sections: readonly ChoiceOption[]
}>()
const shown = defineModel<string>({ required: true })
const strip = ref<HTMLElement | null>(null)

/** Into the row: the strip is the only thing that scrolls for it. */
function reveal(target: Element | null | undefined) {
  if (!props.condensed) return
  target?.scrollIntoView({
    block: 'nearest',
    inline: 'nearest',
    container: 'nearest',
  } as ScrollIntoViewOptions)
}

watch(
  [() => props.condensed, shown],
  async () => {
    await nextTick()
    const index = props.sections.findIndex((section) => section.value === shown.value)
    reveal(strip.value?.querySelectorAll('button')[index])
  },
  { flush: 'post' },
)

function focused(event: FocusEvent) {
  if (event.target instanceof Element) reveal(event.target)
}
</script>

<template>
  <div
    ref="strip"
    class="inspector-tabs"
    :class="{ condensed }"
    @focusin="focused"
  >
    <SegmentedControl
      v-model="shown"
      size="compact"
      :label="label"
      :options="sections"
      :wrap="!condensed"
    />
  </div>
</template>

<style scoped>
.inspector-tabs {
  width: 100%;
  padding-bottom: var(--space-3);

  &.condensed {
    overflow-x: auto;
    scrollbar-color: var(--color-rule-strong) transparent;
    scrollbar-width: thin;
  }
}
</style>
