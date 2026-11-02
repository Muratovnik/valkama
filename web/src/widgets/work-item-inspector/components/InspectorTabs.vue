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
 */
import { onMounted, ref, watch } from 'vue'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'

const props = defineProps<{
  label: string
  sections: readonly ChoiceOption[]
}>()
const shown = defineModel<string>({ required: true })
const strip = ref<HTMLElement | null>(null)

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
watch(shown, revealShown, { flush: 'post' })

function focused(event: FocusEvent) {
  if (event.target instanceof Element) reveal(event.target)
}
</script>

<template>
  <div
    ref="strip"
    class="inspector-tabs"
    @focusin="focused"
  >
    <SegmentedControl
      v-model="shown"
      size="compact"
      :label="label"
      :options="sections"
    />
  </div>
</template>

<style scoped>
.inspector-tabs {
  width: 100%;
  overflow-x: auto;
}
</style>
