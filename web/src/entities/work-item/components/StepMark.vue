<script setup lang="ts">
/**
 * The box a checklist step is ticked in, ticked in the tone of a step done. The card's checklist
 * draws it, and so does the window that confirms a goal's close against its conditions, so a
 * condition reads there as it does on the card. The press around it, with its role, its label
 * and its hit target, is the caller's.
 */
import { computed } from 'vue'

import { statePresentation } from '@/shared/lib/uiSystem.ts'
import VIcon from '@/shared/ui/VIcon.vue'

const props = defineProps<{ done: boolean }>()

const tone = computed(() => statePresentation('checklist-step', props.done ? 'done' : 'open').tone)
</script>

<template>
  <span
    class="step-mark"
    aria-hidden="true"
    :data-tone="tone"
  >
    <VIcon
      v-if="done"
      name="check"
      :size="13"
    />
  </span>
</template>

<style scoped>
.step-mark {
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border: 1px solid var(--color-rule-strong);
  color: var(--color-surface);
  border-radius: var(--radius-status);

  &[data-tone='success'] {
    background: var(--color-success);
    border-color: var(--color-success);
  }
}
</style>
