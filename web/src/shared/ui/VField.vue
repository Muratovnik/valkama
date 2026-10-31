<script setup lang="ts">
/**
 * The frame a labelled control sits in: its label, the control, an optional hint.
 *
 * Three dialogs had each grown their own `.field`, and each one paired it with
 * its own control styling — one filled the input with `--color-control-surface` and
 * another with `--color-surface-recess`, and all three hard-coded a 4px radius while
 * the token said 8px.
 *
 * The frame is a component of its own because half of what it holds is not a
 * native control: `SelectionControl` and `SegmentedControl` carry their own
 * accessible name, so their frame must be a `div` rather than a `<label>` that
 * would wrap a second name around them.
 *
 * An error is part of the field too: it stands under the control, and its id
 * goes to the slot so the control can name it with `aria-describedby`. A form
 * that only says "fill in the required fields" at its foot leaves the reader to
 * find which field it meant.
 */
import { computed, useId } from 'vue'

const props = withDefaults(
  defineProps<{ label: string; as?: 'label' | 'div'; error?: string; hint?: string }>(),
  { hint: '', as: 'label', error: '' },
)
const errorId = useId()
/** The message's id while there is a message, for the control to name. */
const describedBy = computed(() => (props.error ? errorId : undefined))
</script>

<template>
  <component
    :is="as"
    class="field"
  >
    <span class="field-label">{{ label }}</span>
    <slot :error-id="describedBy" />
    <small
      v-if="error"
      :id="errorId"
      class="field-error"
      >{{ error }}</small
    >
    <small
      v-if="hint"
      class="field-hint"
      >{{ hint }}</small
    >
  </component>
</template>

<style scoped>
.field {
  display: grid;
  gap: var(--space-label-value);
  min-width: 0;
}

.field-label {
  color: var(--color-text-muted);
  font: var(--font-field-label);
}

.field-hint {
  color: var(--color-text-muted);
  font: var(--font-detail);
}

.field-error {
  color: var(--color-danger);
  font: var(--font-detail);
}
</style>
