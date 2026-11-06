<script setup lang="ts">
/**
 * The values a `SearchCombobox` of several holds, each a chip before the typed text with
 * a button that takes it out. The field owns which values they are and what taking one out
 * does; this draws them.
 *
 * A chip is the board filter's, one step above the field's fill, with a transparent edge
 * for a forced palette to draw where it clears every fill. Its name stays on one line and
 * ends in an ellipsis; the whole of it is in the list and in its button's name.
 */
import VIcon from '@/shared/ui/VIcon.vue'

defineProps<{
  chips: readonly { label: string; value: string }[]
  disabled: boolean
  /** The name of a chip's remove button. */
  removeLabel: (label: string) => string
}>()
const emit = defineEmits<{ remove: [index: number] }>()
</script>

<template>
  <ul class="combo-chips">
    <li
      v-for="(chip, index) in chips"
      :key="chip.value"
      class="combo-chip"
    >
      <span class="combo-chip-name">{{ chip.label }}</span>
      <button
        class="combo-chip-remove"
        type="button"
        :aria-label="removeLabel(chip.label)"
        :disabled="disabled"
        @click="emit('remove', index)"
      >
        <VIcon
          name="close"
          :size="14"
        />
      </button>
    </li>
  </ul>
</template>

<style scoped>
.combo-chips {
  display: contents;
}

.combo-chip {
  display: inline-flex;
  gap: var(--space-1);
  align-items: center;
  min-width: 0;
  max-width: 22ch;
  min-height: var(--size-control-inline);
  padding: 0 var(--space-1) 0 var(--space-2);
  border: 1px solid transparent;
  font: var(--font-detail);
  background: var(--color-surface-active);
  border-radius: var(--radius-control);
}

.combo-chip-name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.combo-chip-remove {
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  color: var(--color-text-muted);
  background: transparent;
  border-radius: var(--radius-status);
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--color-text);
  }

  &:focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 1px;
  }
}
</style>
