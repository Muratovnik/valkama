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
 * accessible name, so their frame is a `div` (`as="div"`) whose label names nothing.
 *
 * Otherwise the label names the control through `for`, and holds nothing but its
 * words. It used to wrap the whole frame, and a label passes a pointer on any of it
 * to its control: resting on the hint under a field lit the field as hovered, and the
 * hint stood inside what named the control instead of describing it. The id comes to
 * the slot (`controlId`), unless the host names its own, and so does the id list the
 * control describes itself by (`describedBy`): the hint and, while there is one, the error.
 *
 * An error is part of the field too: it stands under the control. A form that only
 * says "fill in the required fields" at its foot leaves the reader to find which field
 * it meant. It carries a mark the hint has not (`FieldError`).
 */
import { computed, useId } from 'vue'

import FieldError from '@/shared/ui/FieldError.vue'

const props = withDefaults(
  defineProps<{
    label: string
    as?: 'label' | 'div'
    /** The control's id, for a host that names it itself. */
    controlId?: string
    error?: string
    /**
     * Keep the label for assistive technology only, for a field in a toolbar
     * whose placeholder and neighbours already say what it is for.
     */
    hideLabel?: boolean
    hint?: string
  }>(),
  { hint: '', as: 'label', controlId: undefined, error: '', hideLabel: false },
)
const ownId = useId()
const errorId = useId()
const hintId = useId()
const control = computed(() => props.controlId ?? ownId)
/** The label names its control; a frame whose control names itself shows words alone. */
const labelTag = computed(() => (props.as === 'label' ? 'label' : 'span'))
const labelFor = computed(() => (props.as === 'label' ? control.value : undefined))
/** What the control is described by: the message while there is one, then the hint. */
const describedBy = computed(
  () =>
    [props.error ? errorId : '', props.hint ? hintId : ''].filter(Boolean).join(' ') || undefined,
)
</script>

<template>
  <div class="field">
    <component
      :is="labelTag"
      class="field-label"
      :class="{ 'visually-hidden': hideLabel }"
      :for="labelFor"
      >{{ label }}</component
    >
    <slot
      :control-id="control"
      :described-by="describedBy"
    />
    <FieldError
      v-if="error"
      :id="errorId"
      >{{ error }}</FieldError
    >
    <small
      v-if="hint"
      :id="hintId"
      class="field-hint"
      >{{ hint }}</small
    >
  </div>
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
