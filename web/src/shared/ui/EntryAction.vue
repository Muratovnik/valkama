<script setup lang="ts">
import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'
/**
 * One thing that can be done to an entry of a discussion: replying, its mark, changing an
 * answer. An entry is what a reader came for, so what can be done to it recedes. It is an
 * icon in the muted ink at rest, and its words stand under the pointer and for a screen reader.
 *
 * It stands in `EntryHead`, which says how large a target it is, and always shows: a phone has
 * no pointer to bring it out with. The ink rises under the keys as it does under the pointer,
 * which `VButton`'s ghost does for the pointer alone.
 */
import VButton from '@/shared/ui/VButton.vue'
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{
  /** One meaning, one icon key, wherever the entry stands. */
  icon: string
  label: string
  disabled?: boolean
}>()
</script>

<template>
  <VButton
    v-tooltip.name="label"
    class="entry-action"
    variant="ghost"
    size="inline"
    :disabled="disabled"
    :aria-label="label"
    icon
  >
    <VIcon
      :name="icon"
      :size="16"
    />
  </VButton>
</template>

<style scoped>
.entry-action:focus-visible {
  color: var(--color-text);
}
</style>
