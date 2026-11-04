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
 * find which field it meant. It carries a mark the hint has not (`FieldError`).
 */
import { computed, useId } from 'vue'

import FieldError from '@/shared/ui/FieldError.vue'

const props = withDefaults(
  defineProps<{
    label: string
    as?: 'label' | 'div'
    error?: string
    /**
     * Keep the label for assistive technology only, for a field in a toolbar
     * whose placeholder and neighbours already say what it is for.
     */
    hideLabel?: boolean
    hint?: string
  }>(),
  { hint: '', as: 'label', error: '', hideLabel: false },
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
    <span
      class="field-label"
      :class="{ 'visually-hidden': hideLabel }"
      >{{ label }}</span
    >
    <slot :error-id="describedBy" />
    <FieldError
      v-if="error"
      :id="errorId"
      >{{ error }}</FieldError
    >
    <small
      v-if="hint"
      class="field-hint"
      >{{ hint }}</small
    >
  </component>
</template>

<style scoped>
/* Its rows stand at the top. Beside a field whose hint takes two lines the cell is taller, and
   rows stretched to fill it moved this field's input down from its neighbour's. */
.field {
  display: grid;
  gap: var(--space-label-value);
  align-content: start;
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
</style>
