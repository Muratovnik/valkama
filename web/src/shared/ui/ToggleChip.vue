<script setup lang="ts">
/**
 * One toggle that stands on its own: on or off, beside others that are too.
 *
 * Not a segment. A segmented control is one choice among exclusive options;
 * these are independent switches a reader presses in any combination, such as
 * the Work filter's presets. Pressed is the chosen segment's ground, the full
 * ink and a bar under what it says, so it reads as on without a colour that
 * means something else and with more than a change of tone.
 *
 * A press changes no box. A check set beside the words made the chip 18px wider,
 * and everything along the row moved to make that room, and back.
 */
defineProps<{ pressed: boolean }>()

const emit = defineEmits<{ toggle: [] }>()
</script>

<template>
  <button
    class="toggle-chip"
    type="button"
    :aria-pressed="pressed"
    @click="emit('toggle')"
  >
    <slot />
  </button>
</template>

<style scoped>
/* A compact control, the height of the segmented control beside it. */
.toggle-chip {
  position: relative;
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--space-1);
  align-items: center;
  min-height: var(--size-control-height-compact);
  padding: 0 var(--space-3);
  border: 0;
  color: var(--color-text-muted);
  font: var(--font-control);
  white-space: nowrap;
  background: var(--color-control-surface);
  border-radius: var(--radius-control);
  cursor: pointer;

  &:hover,
  &[aria-pressed='true'] {
    color: var(--color-text);
  }

  &[aria-pressed='true'] {
    background: var(--color-surface-active);

    /* In the chip's own ink, in a forced palette too, which would clear a fill. */
    &::after {
      content: '';
      position: absolute;
      inset-block-end: var(--space-1);
      inset-inline: var(--space-3);
      block-size: var(--space-half);
      background: currentcolor;
      forced-color-adjust: none;
    }
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
  }
}
</style>
