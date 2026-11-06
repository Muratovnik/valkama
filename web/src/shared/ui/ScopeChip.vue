<script setup lang="ts">
/**
 * What a view is narrowed to, and the one way back out of it.
 *
 * The chip names the narrowing and is itself the control that removes it, so
 * the way out stands where the reader sees what they are looking at. Every view
 * of a planning space that can be scoped to a chain shows the same chip, which
 * is why it is a primitive rather than the graph's own button.
 */
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{
  /** The accessible name: what pressing the chip does. */
  exitLabel: string
  /** What the view is narrowed to, as the chip prints it. */
  label: string
}>()

const emit = defineEmits<{ exit: [] }>()
</script>

<template>
  <button
    class="scope-chip"
    type="button"
    :aria-label="exitLabel"
    @click="emit('exit')"
  >
    {{ label }}
    <VIcon
      name="close"
      :size="14"
    />
  </button>
</template>

<style scoped>
.scope-chip {
  display: inline-flex;
  flex: 0 1 auto;
  gap: var(--space-2);
  align-items: center;
  min-width: 0;
  min-height: var(--size-control-height-compact);
  padding: 0 var(--space-3);
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-chip);
  font-variant-numeric: tabular-nums;
  background: var(--color-surface-muted);
  border-radius: var(--radius-control);
  cursor: pointer;

  /* A forced palette clears the fill, and the chip read as words with a cross. */
  @media (forced-colors: active) {
    outline: 1px solid ButtonText;
    outline-offset: -1px;
  }

  &:hover {
    color: var(--color-text);
    background: var(--color-control-surface);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}
</style>
