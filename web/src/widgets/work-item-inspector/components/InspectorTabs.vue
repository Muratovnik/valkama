<script setup lang="ts">
/**
 * The card's sections, as the strip that sticks to the top of its scroller.
 *
 * It stays pinned at every position, so it holds to one row: two rows of sections were
 * a third of what a phone kept pinned. Where one row cannot hold them it scrolls inside
 * itself, over the thin bar every scroller here has, because a cut that fell between
 * two sections read as the whole strip. The strip is a `ChoiceStrip`: it fades the end a
 * section is cut at, and brings the one shown into the row whenever it changes, each one
 * the keyboard reaches, and the one a press focused once the press is over.
 *
 * They are tabs over the card's body, and every section shows the moment it is chosen —
 * what one reads is read with the card — so the arrows show a section as they reach it.
 */
import { computed } from 'vue'

import type { ChoiceOption } from '@/shared/ui/choiceControls.ts'
import ChoiceStrip from '@/shared/ui/ChoiceStrip.vue'
import SegmentedControl from '@/shared/ui/SegmentedControl.vue'
import type { TabIds } from '@/shared/ui/tabIds.ts'

const props = defineProps<{
  label: string
  sections: readonly ChoiceOption[]
  /** The ids its sections share with the panel that shows the chosen one. */
  tabs: TabIds
}>()
const shown = defineModel<string>({ required: true })

const chosen = computed(() => props.sections.findIndex((section) => section.value === shown.value))
</script>

<template>
  <ChoiceStrip
    class="inspector-tabs"
    :chosen="chosen"
  >
    <SegmentedControl
      v-model="shown"
      size="compact"
      :label="label"
      :options="sections"
      :tabs="tabs"
    />
  </ChoiceStrip>
</template>

<style scoped>
.inspector-tabs {
  width: 100%;
}
</style>
